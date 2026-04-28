/**
 * POST /api/auth/scan-login
 *
 * Completes the scan-to-login flow by minting a customer session AS-IF
 * the user had just signed in via magic-link.
 *
 * Body (charger path, legacy):
 *     { pairingCode, chargeBoxId, idTag, nonce, t }
 * Body (device path, customer remote-login on admin's phone):
 *     { pairingCode, deviceId,    idTag, nonce, t }
 *
 * The HMAC nonce is bound to (idTag, pairingCode, pairableId, t) where
 * pairableId is whichever of chargeBoxId/deviceId the request supplies.
 * The verifications row identifier mirrors that split:
 *   - charger: `scan-pair:{chargeBoxId}:{pairingCode}`
 *   - device:  `device-scan:{deviceId}:{pairingCode}`
 *
 * Verification chain (each step rejects with a generic 4xx — never leak
 * which step failed, to deny enumeration):
 *   1. Re-compute the HMAC over (idTag, pairingCode, pairableId, t) and
 *      constant-time compare with the supplied nonce.        -> 403
 *   2. Reject if t > 60s old (replay window).                -> 403
 *   3. ATOMIC single-use UPDATE on the matching verifications
 *      row, transitioning status to "consumed".              -> 429 on miss
 *   4. Look up user_mappings by steve_ocpp_id_tag.           -> 401 generic
 *   5. Require mapping.userId IS NOT NULL                    -> 401 generic
 *   6. Require role = 'customer' (HARD restriction).         -> 401 generic
 *   7. createCustomerSession(userId, req) → headers
 *   8. Audit scan.login_success
 *   9. Respond 200 with Set-Cookie + { redirectTo: "/" }
 *
 * Rate limits:
 *   - scanlogin:ip:{ip}        — 10/min (also enforced in middleware)
 *   - scanlogin:pairing:{code} — 1 (single-use upper bound; the atomic
 *     UPDATE is the actual single-use enforcement)
 *
 * Public route — no session required (we're MAKING the session here).
 */

import { and, eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { userMappings, users, verifications } from "../../../src/db/schema.ts";
import { config } from "../../../src/lib/config.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import { createCustomerSession } from "../../../src/lib/auth-helpers.ts";
import {
  logScanLoginFailed,
  logScanLoginSuccess,
} from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ScanLogin");

const REPLAY_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 10;

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Headers,
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (extraHeaders) {
    for (const [k, v] of extraHeaders.entries()) headers.append(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

const _enc = new TextEncoder();

let cachedHmacKey: CryptoKey | null = null;
async function getHmacKey(): Promise<CryptoKey> {
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = await crypto.subtle.importKey(
    "raw",
    _enc.encode(config.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cachedHmacKey;
}

function hexEncode(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

/** Constant-time string compare. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function signNonce(
  idTag: string,
  pairingCode: string,
  pairableId: string,
  t: number,
): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    _enc.encode(`${idTag}:${pairingCode}:${pairableId}:${t}`),
  );
  return hexEncode(sig);
}

interface LoginBody {
  pairingCode?: string;
  chargeBoxId?: string;
  deviceId?: string;
  idTag?: string;
  nonce?: string;
  t?: number;
}

export const handler = define.handlers({
  async POST(ctx) {
    const ip = getClientIp(ctx.req);
    const ua = ctx.req.headers.get("user-agent");
    if (!await checkRateLimit(`scanlogin:ip:${ip}`, RATE_LIMIT_PER_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    let body: LoginBody;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const pairingCode = typeof body.pairingCode === "string"
      ? body.pairingCode
      : "";
    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId
      : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    const idTag = typeof body.idTag === "string" ? body.idTag.trim() : "";
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    const t = typeof body.t === "number" ? body.t : NaN;

    if (
      !pairingCode || !idTag || !nonce ||
      !Number.isFinite(t) ||
      (!chargeBoxId && !deviceId) ||
      (chargeBoxId && deviceId)
    ) {
      return jsonResponse(400, { error: "invalid_body" });
    }
    // Pick one — the rest of the handler uses `pairableId` + `identifier`
    // for both branches.
    const pairableType: "charger" | "device" = deviceId ? "device" : "charger";
    const pairableId = pairableType === "device" ? deviceId : chargeBoxId;
    const identifier = pairableType === "device"
      ? `device-scan:${pairableId}:${pairingCode}`
      : `scan-pair:${pairableId}:${pairingCode}`;

    // Per-pairing single-use upper bound (the atomic UPDATE below is
    // the actual race-safe enforcement, but this also prevents a single
    // pairing from being used to bombard the auth path).
    if (
      !await checkRateLimit(`scanlogin:pairing:${pairingCode}`, 1)
    ) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    // Step 1: HMAC mismatch → 403.
    let expected: string;
    try {
      expected = await signNonce(idTag, pairingCode, pairableId, t);
    } catch (err) {
      log.error("HMAC sign failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!constantTimeEqual(expected, nonce.toLowerCase())) {
      void logScanLoginFailed({
        ip,
        ua,
        route: "/api/auth/scan-login",
        metadata: { reason: "hmac_mismatch", pairableType, pairableId },
      });
      return jsonResponse(403, { error: "forbidden" });
    }

    // Step 2: replay window check.
    const ageMs = Date.now() - t;
    if (ageMs < 0 || ageMs > REPLAY_WINDOW_MS) {
      void logScanLoginFailed({
        ip,
        ua,
        route: "/api/auth/scan-login",
        metadata: {
          reason: "stale_timestamp",
          ageMs,
          pairableType,
          pairableId,
        },
      });
      return jsonResponse(403, { error: "stale" });
    }

    // Step 3: atomic single-use consume.
    //
    // Two valid starting states:
    //   - status='armed': the unknown-tag log-scrape path (charger) and the
    //     phone scan-result path. Both transition straight from armed to
    //     consumed here.
    //   - status='matched' AND matchedIdTag === idTag (charger only): the
    //     pre-authorize hook path. /api/ocpp/pre-authorize transitioned
    //     the row to matched and stamped the idTag; scan-login finalizes
    //     it. Without accepting this state, the hook pipeline can't
    //     complete login (the row has already moved past 'armed').
    let consumedRows: { id: string }[];
    try {
      const result = await db.execute<{ id: string }>(sql`
        UPDATE verifications
        SET value = jsonb_set(value::jsonb, '{status}', '"consumed"')::text,
            updated_at = now()
        WHERE identifier = ${identifier}
          AND expires_at > now()
          AND (
            value::jsonb->>'status' = 'armed'
            OR (
              value::jsonb->>'status' = 'matched'
              AND value::jsonb->>'matchedIdTag' = ${idTag}
            )
          )
        RETURNING id
      `);
      consumedRows = (Array.isArray(result)
        ? result
        : (result as { rows?: { id: string }[] }).rows ?? []) as {
          id: string;
        }[];
    } catch (err) {
      log.error("Failed atomic consume", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (consumedRows.length !== 1) {
      void logScanLoginFailed({
        ip,
        ua,
        route: "/api/auth/scan-login",
        metadata: {
          reason: "pairing_consumed_or_expired",
          pairableType,
          pairableId,
        },
      });
      // Unify with the per-pairing rate-limit response (429 / "rate_limited")
      // above. Returning a distinct status/body here lets an attacker
      // distinguish "this pairing code was real and just got consumed" from
      // "this pairing code is throttled" — the latter is information about
      // a real code's existence. Collapsing both into 429 hides the signal.
      return jsonResponse(429, { error: "rate_limited" });
    }

    // Step 4 + 5: look up the user_mapping.
    let mapping: { id: number; userId: string | null } | undefined;
    try {
      const [m] = await db
        .select({
          id: userMappings.id,
          userId: userMappings.userId,
        })
        .from(userMappings)
        .where(
          and(
            eq(userMappings.steveOcppIdTag, idTag),
            eq(userMappings.isActive, true),
          ),
        )
        .limit(1);
      mapping = m;
    } catch (err) {
      log.error("Failed mapping lookup", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!mapping) {
      void logScanLoginFailed({
        ip,
        ua,
        route: "/api/auth/scan-login",
        metadata: {
          reason: "no_mapping",
          pairableType,
          pairableId,
          idTagPrefix: idTag.slice(0, 4),
        },
      });
      // 401 generic — never tell the caller the tag was unknown.
      return jsonResponse(401, { error: "unauthorized" });
    }
    if (!mapping.userId) {
      // The plan spec calls this "unmapped" — mapping exists but has no
      // linked user. Track A-Lifecycle (provisioner) is supposed to
      // backfill these eventually, but for MVP we just refuse.
      void logScanLoginFailed({
        ip,
        ua,
        route: "/api/auth/scan-login",
        metadata: {
          reason: "unmapped",
          pairableType,
          pairableId,
          mappingId: mapping.id,
        },
      });
      return jsonResponse(401, { error: "unauthorized" });
    }

    // Step 6: role guard — admin tags do NOT log in via scan.
    let userRow: { id: string; role: string } | undefined;
    try {
      const [u] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, mapping.userId))
        .limit(1);
      userRow = u;
    } catch (err) {
      log.error("Failed user lookup", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!userRow || userRow.role !== "customer") {
      void logScanLoginFailed({
        ip,
        ua,
        route: "/api/auth/scan-login",
        metadata: {
          reason: "role_not_customer",
          role: userRow?.role ?? "missing",
          pairableType,
          pairableId,
        },
      });
      return jsonResponse(401, { error: "unauthorized" });
    }

    // Step 7: mint the session.
    let sessionHeaders: Headers;
    try {
      const result = await createCustomerSession(userRow.id, ctx.req);
      sessionHeaders = result.headers;
    } catch (err) {
      log.error("createCustomerSession threw", {
        userId: userRow.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    // Step 8: audit success.
    void logScanLoginSuccess({
      userId: userRow.id,
      ip,
      ua,
      route: "/api/auth/scan-login",
      metadata: { pairableType, pairableId, mappingId: mapping.id },
    });

    // Best-effort cleanup of the consumed verification row (sync-worker
    // also prunes expired rows; this is purely cosmetic).
    void db
      .delete(verifications)
      .where(eq(verifications.id, consumedRows[0].id))
      .catch((err: unknown) => {
        log.warn("Failed to delete consumed verification", {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Step 9: pass Set-Cookie through to the caller.
    return jsonResponse(200, { redirectTo: "/" }, sessionHeaders);
  },
});
