/**
 * POST /api/devices/scan-result
 *
 * ExpresScan / Wave 3 Track C-result — bearer-authenticated endpoint that
 * accepts the iPhone's HMAC-signed scan result for an armed pairing,
 * atomically claims the verifications row, publishes `scan.intercepted` so
 * the browser-side modal can pick up the idTag, and returns the
 * enriched `EnrichedScanResult` shape so the iPhone can render its
 * success screen without a second round trip.
 *
 * Auth: bearer (`ctx.state.device` populated by Track A's `resolveBearer`).
 * The middleware filters revoked tokens / soft-deleted devices, so a
 * populated context implies the device row is live.
 *
 * Body shape (`EnrichedScanResult` request):
 *
 *     { idTag: string, pairingCode: string, ts: number, nonce: string }
 *
 * `ts` is unix seconds; `nonce` is lowercase hex HMAC-SHA256.
 *
 *     nonce = HMAC-SHA256(
 *       key = base64url-decode(deviceSecret),
 *       msg = "scan-result/v1|" + idTag + "|" + pairingCode + "|" + deviceId + "|" + ts
 *     )
 *
 * Domain separation prefix (`"scan-result/v1|"`) is REQUIRED — the
 * `deviceSecret` MUST NOT be reused for any other HMAC purpose. See
 * `60-security.md` §6.
 *
 * Anti-enumeration: an "already consumed / expired pairing" returns
 * **429 `rate_limited`**, NOT 410 — mirrors `scan-login.ts:247-256` so
 * an attacker can't distinguish "pairing was real and just got consumed"
 * from "throttled."
 *
 * Idempotency: wrapped in `withIdempotency()`. iOS retries with the same
 * `Idempotency-Key` get the cached 200 — important because the success
 * screen renders off this response and a stale retry mustn't trip the
 * single-use atomic claim.
 *
 * NEVER routes through `/api/ocpp/pre-authorize` — see security
 * non-negotiables item 9.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { withIdempotency } from "../../../src/lib/idempotency.ts";
import {
  logDeviceScanCompleted,
  logScanLoginFailed,
} from "../../../src/lib/audit.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";
import { enrichByIdTag } from "../../../src/services/device-enrichment.service.ts";
import type { EnrichedScanResult } from "../../../src/lib/types/devices.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceScanResult");

const ROUTE = "/api/devices/scan-result";
/** ±60s clock skew window — matches `scan-login.ts` REPLAY_WINDOW_MS. */
const CLOCK_SKEW_S = 60;

// ============================================================================
// Body schema. Strict so a typo'd field doesn't slip past validation.
// ============================================================================

const bodySchema = z.object({
  idTag: z.string().min(1).max(64),
  pairingCode: z.string().min(1).max(64),
  ts: z.number().int().finite(),
  nonce: z.string().min(1).max(128),
}).strict();

type ScanResultBody = z.infer<typeof bodySchema>;

// ============================================================================
// HMAC helpers
// ============================================================================

const _enc = new TextEncoder();

/**
 * Decode a base64url string (no padding) to a Uint8Array. The device's
 * `secret` column is RFC4648 base64url; iOS encodes the raw 32 bytes the
 * same way before storing in Keychain.
 */
function base64UrlDecode(s: string): Uint8Array {
  // Pad to multiple of 4. base64url alphabet: A-Z a-z 0-9 - _
  const replaced = s.replaceAll("-", "+").replaceAll("_", "/");
  const padLen = (4 - (replaced.length % 4)) % 4;
  const padded = replaced + "=".repeat(padLen);
  // atob throws on invalid input; caller catches.
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexEncode(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

/** Constant-time string compare — mirrors `scan-login.ts:96-103`. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Compute the scan-result HMAC for the given inputs. Throws on bad secret
 * encoding or an unrecoverable WebCrypto error — caller maps to 401 (not
 * 500, because a malformed-secret-row implies a tampered device row,
 * which is unauthorized in the threat model).
 */
async function signNonce(
  rawSecret: string,
  idTag: string,
  pairingCode: string,
  deviceId: string,
  ts: number,
): Promise<string> {
  const keyBytes = base64UrlDecode(rawSecret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const msg = `scan-result/v1|${idTag}|${pairingCode}|${deviceId}|${ts}`;
  const sig = await crypto.subtle.sign("HMAC", key, _enc.encode(msg));
  return hexEncode(sig);
}

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

interface ClaimedRow {
  /** Verification row id (text PK). Used for cleanup later if needed. */
  id: string;
  /**
   * Original pairing purpose stored when the row was armed. Forwarded into
   * `scan.intercepted` so downstream consumers (web modal, audit) can
   * branch on intent without re-reading the DB.
   */
  purpose: string;
}

// ============================================================================
// Handler
// ============================================================================

export const handler = define.handlers({
  async POST(ctx) {
    return await withIdempotency(ctx, ROUTE, async () => {
      const t0 = performance.now();
      const ip = getClientIp(ctx.req);
      const ua = ctx.req.headers.get("user-agent");

      // 1. Defensive bearer guard. Middleware already enforces this for
      //    `/api/devices/*`; the explicit check keeps the handler safe if
      //    a routing change ever exposes it to cookie auth.
      const device = ctx.state.device;
      if (!device) {
        return jsonResponse(401, { error: "unauthorized" });
      }
      const deviceId = device.id;

      // 2. Body validation — JSON parse + schema. 400 invalid_body for
      //    both shape and content failures.
      let body: ScanResultBody;
      try {
        const raw = await ctx.req.json();
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(400, { error: "invalid_body" });
        }
        body = parsed.data;
      } catch {
        return jsonResponse(400, { error: "invalid_body" });
      }

      // Normalize idTag to hex uppercase — both sides of the HMAC MUST agree
      // on this canonical form (see `60-security.md` §6).
      const idTag = body.idTag.toUpperCase();
      const { pairingCode, ts, nonce } = body;

      // 3. Clock-skew window — ±60s of server clock. The window is a
      //    replay-protection guardrail; the atomic claim below is the
      //    actual single-use enforcement.
      const nowS = Math.floor(Date.now() / 1000);
      if (Math.abs(nowS - ts) > CLOCK_SKEW_S) {
        // No audit row here — this is "client clock is wrong", not a
        // probe. The audit is written on actual auth failures below.
        return jsonResponse(400, { error: "clock_skew" });
      }

      // 4. Recompute HMAC, constant-time compare. A mismatch is a 401
      //    invalid_nonce. Same response shape as the bearer-missing 401
      //    so an attacker can't probe the difference.
      let expected: string;
      try {
        expected = await signNonce(
          device.secret,
          idTag,
          pairingCode,
          deviceId,
          ts,
        );
      } catch (err) {
        // base64-decode failure or WebCrypto outage. Treat as
        // unauthorized: a device row whose secret won't decode is a
        // tampered/corrupt artifact, not an internal bug from the
        // caller's perspective.
        log.warn("HMAC sign failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        void logScanLoginFailed({
          ip,
          ua,
          route: ROUTE,
          metadata: {
            reason: "hmac_sign_failed",
            deviceId,
            idTagPrefix: idTag.slice(0, 4),
          },
        });
        return jsonResponse(401, { error: "invalid_nonce" });
      }
      if (!constantTimeEqual(expected, nonce.toLowerCase())) {
        void logScanLoginFailed({
          ip,
          ua,
          route: ROUTE,
          metadata: {
            reason: "hmac_mismatch",
            deviceId,
            idTagPrefix: idTag.slice(0, 4),
          },
        });
        return jsonResponse(401, { error: "invalid_nonce" });
      }

      // 5. Atomic single-use claim of the device-scan verifications row.
      //    Mirrors the pattern in `scan-login.ts:222`: UPDATE …
      //    WHERE status='armed' AND expires_at > now() RETURNING
      //    value::jsonb. Zero rows → 429 rate_limited (anti-enumeration,
      //    matches scan-login.ts:247-256).
      //
      //    On success we ALSO stamp `matchedIdTag` into the row so the
      //    polling fallback (`GET /api/devices/scan-result/{pairingCode}`)
      //    can recover the result without re-running enrichment from
      //    scratch when the device retries after a timeout. The arm-time
      //    `expires_at` is preserved — the cleanup cron will GC the row
      //    on its existing schedule.
      const identifier = `device-scan:${deviceId}:${pairingCode}`;
      let claimed: ClaimedRow | null = null;
      try {
        const result = await db.execute<{ id: string; value: unknown }>(sql`
          UPDATE verifications
          SET value = jsonb_set(
                jsonb_set(value::jsonb, '{status}', '"consumed"'),
                '{matchedIdTag}',
                to_jsonb(${idTag}::text)
              )::text,
              updated_at = now()
          WHERE identifier = ${identifier}
            AND expires_at > now()
            AND value::jsonb->>'status' = 'armed'
          RETURNING id, value::jsonb AS value
        `);
        const rows = (Array.isArray(result)
          ? result
          : (result as { rows?: { id: string; value: unknown }[] }).rows ??
            []) as { id: string; value: unknown }[];
        if (rows.length === 1) {
          const v = rows[0].value as { purpose?: unknown } | null;
          const purpose = typeof v?.purpose === "string" ? v.purpose : "login";
          claimed = { id: rows[0].id, purpose };
        }
      } catch (err) {
        log.error("Atomic claim failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal" });
      }
      if (!claimed) {
        // 429 rate_limited — covers consumed / expired AND actual
        // throttling. Audit it as a scan-login-style failure so probes
        // are traceable; we still don't tell the caller which case.
        void logScanLoginFailed({
          ip,
          ua,
          route: ROUTE,
          metadata: {
            reason: "pairing_consumed_or_expired",
            deviceId,
            idTagPrefix: idTag.slice(0, 4),
          },
        });
        return jsonResponse(429, { error: "rate_limited" });
      }

      // 6. Publish `scan.intercepted` so the browser-side scan modal
      //    (web `/api/auth/scan-detect` SSE) sees the result with no
      //    behavior change. `pairableType: "device"` + `pairableId:
      //    deviceId` is the device-flow analog of the existing charger
      //    flow's `pairableType: "charger"`.
      try {
        eventBus.publish({
          type: "scan.intercepted",
          payload: {
            idTag,
            pairableType: "device",
            pairableId: deviceId,
            pairingCode,
            purpose: claimed.purpose,
            t: Date.now(),
            source: "device-scan-result",
          },
        });
      } catch (err) {
        log.warn("Failed to publish scan.intercepted", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 7. Enrich. The service tolerates DB errors and returns a
      //    not-found shape, which the contract surfaces as `found:
      //    false` + null tag/customer/subscription blocks. The pairing
      //    is already consumed at this point — there's no path back.
      const enriched = await enrichByIdTag(idTag);

      const latencyMs = Math.round(performance.now() - t0);

      // 8. Audit `device.scan.completed`. The plan calls out:
      //    `idTagPrefix: idTag.slice(0,4)` ONLY (never full UID); +
      //    deviceId, success, latencyMs.
      void logDeviceScanCompleted({
        userId: device.ownerUserId,
        ip,
        ua,
        route: ROUTE,
        metadata: {
          deviceId,
          idTagPrefix: idTag.slice(0, 4),
          success: true,
          latencyMs,
        },
      });

      // 9. Optional: fan out `device.scan.completed` for observability +
      //    downstream consumers (admin dashboards, future sinks). The
      //    iOS-stream subscription doesn't currently forward this — the
      //    device gets the enriched result back synchronously below — so
      //    this fire is purely additive.
      try {
        eventBus.publish({
          type: "device.scan.completed",
          payload: {
            deviceId,
            pairingCode,
            idTag,
            t: Date.now(),
            success: true,
          },
        });
      } catch (err) {
        log.warn("Failed to publish device.scan.completed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 10. Build `EnrichedScanResult` and return.
      const responseBody: EnrichedScanResult = {
        ok: true,
        found: enriched.found,
        pairingCode,
        idTag,
        resolvedAtIso: new Date().toISOString(),
        tag: enriched.tag,
        customer: enriched.customer,
        subscription: enriched.subscription,
      };
      return jsonResponse(200, responseBody);
    });
  },
});

// ============================================================================
// Test-only exports — handler-direct unit tests use these to exercise the
// HMAC machinery against the canonical fixture vectors.
// ============================================================================

export const _signNonceForTests = signNonce;
export const _constantTimeEqualForTests = constantTimeEqual;
export const _base64UrlDecodeForTests = base64UrlDecode;
