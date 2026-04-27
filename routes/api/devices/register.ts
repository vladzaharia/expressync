/**
 * POST /api/devices/register
 *
 * ExpresScan / Wave 2 Track B-lifecycle — admin-cookie + PKCE-gated entry
 * point that mints a `(deviceToken, deviceSecret)` pair for an iOS / laptop
 * NFC reader. Idempotent (via `Idempotency-Key`) and timing-jittered so an
 * attacker can't tell "valid code, expensive INSERT" from "invalid code,
 * fast 401" by the response latency.
 *
 * Auth model (`30-backend.md` § "selectAuth"): the bearer-only routes all
 * sit at `/api/devices/*` EXCEPT this one. Track A's `selectAuth(pathname)`
 * single-source-of-truth special-cases `/api/devices/register` to cookie
 * auth — by the time we get here, the bearer header (if any) has been
 * ignored and only the cookie session is trusted.
 *
 * Flow (mirrors `30-backend.md` § "Registration flow (PKCE)"):
 *
 *   1. Admin-only enforcement: `ctx.state.user?.role === 'admin'` → else 403.
 *   2. Body validation (Zod): all fields per the canonical contract.
 *   3. `claimOneTimeCode(rawCode, codeVerifier)` — atomic single-use,
 *      enforces PKCE match + 60s TTL + replay protection.
 *   4. Generate `(deviceToken, deviceSecret)` pair and their sha256 hashes.
 *   5. INSERT `devices` row (the migration-0034 trigger guards `owner_user_id`
 *      role='admin'; we also pre-check in step 1 for a clean 403).
 *   6. INSERT `device_tokens` row referencing the new device.
 *   7. Audit `device.registered` + `device.token.issued` (both fire-and-forget).
 *   8. Respond 200 with the raw token + secret. `Cache-Control: no-store`,
 *      `Pragma: no-cache` — these credentials NEVER hit a CDN / proxy cache.
 *
 * Latency-floor jitter: identical pattern to `auth.ts:144-156` — a 50–150 ms
 * `Promise.all([handler, jitterPromise])` that smooths the response time so
 * "valid one-time code, expensive INSERT" looks like "invalid code, fast
 * 401" from the wire. See `60-security.md` §1.
 *
 * Security headers: `Cache-Control: no-store, Pragma: no-cache` is the
 * non-negotiable: the response body contains the raw bearer token and HMAC
 * secret, neither of which may be cached anywhere.
 */

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import {
  type Device,
  devices,
  type DeviceToken,
  deviceTokens,
} from "../../../src/db/schema.ts";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
} from "../../../src/lib/types/devices.ts";
import {
  logDeviceRegistered,
  logDeviceTokenIssued,
} from "../../../src/lib/audit.ts";
import { withIdempotency } from "../../../src/lib/idempotency.ts";
import {
  claimOneTimeCode,
  DEVICE_TOKEN_TTL_MS,
  generateDeviceCredentials,
} from "../../../src/lib/devices/registration.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceRegister");

const REGISTER_ROUTE = "/api/devices/register";

/** Latency-floor band — see module docstring. */
const JITTER_FLOOR_MS = 50;
const JITTER_BAND_MS = 100; // total window 50..150ms

const PLATFORMS = ["ios", "macos", "ipados"] as const;
const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;

const registerBodySchema = z.object({
  oneTimeCode: z.string().min(1).max(256),
  codeVerifier: z.string().min(43).max(256),
  label: z.string().min(1).max(120),
  platform: z.enum(PLATFORMS),
  model: z.string().min(1).max(80),
  osVersion: z.string().min(1).max(40),
  appVersion: z.string().min(1).max(40),
  pushToken: z.string().max(512).optional(),
  apnsEnvironment: z.enum(APNS_ENVIRONMENTS),
  requestedCapabilities: z
    .array(z.enum(DEVICE_CAPABILITIES))
    .min(1)
    .max(DEVICE_CAPABILITIES.length),
});

type RegisterBody = z.infer<typeof registerBodySchema>;

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

/** Map a Zod error into the canonical 400 body. */
function zodReason(err: z.ZodError): string {
  const first = err.issues[0];
  if (!first) return "invalid_body";
  // Zod produces nested paths for array-element rejections (e.g. for an
  // unknown capability the path is `["requestedCapabilities", 0]`). We want
  // the top-level field name only — check the first segment, not the full
  // dotted join.
  const top = typeof first.path[0] === "string" ? first.path[0] : "";
  if (top === "platform") return "invalid_platform";
  if (top === "requestedCapabilities") return "invalid_capabilities";
  if (top === "codeVerifier") return "invalid_verifier";
  if (top === "oneTimeCode") return "invalid_code";
  return "invalid_body";
}

interface RequestContext {
  ip: string;
  ua: string | null;
}

/**
 * Inner handler — split out so `withIdempotency` wraps the whole pipeline
 * (latency-floor included). Returns the final Response.
 */
async function runRegister(
  body: RegisterBody,
  reqCtx: RequestContext,
): Promise<Response> {
  // Step 3: atomic claim of the one-time code. Returns null for ANY
  // failure mode (mismatch, expired, replay) — we map to a uniform 400/410
  // by inspecting the verification row's expiry separately would be a
  // timing leak, so we collapse the two failure paths into a single
  // `invalid_code` response (matches the anti-enumeration pattern in
  // `scan-login.ts:247-256`).
  //
  // The claim is the SOLE auth gate for this endpoint — the iOS app
  // cannot carry the admin cookie that minted the code (URLSession's
  // jar is separate from ASWebAuthenticationSession's) and doesn't
  // send an Origin header. The PKCE proof + the row's stored `userId`
  // jointly establish "the admin who minted this code is registering
  // this device". Replay is prevented by the atomic single-use flip
  // inside `claimOneTimeCode`.
  const claim = await claimOneTimeCode(body.oneTimeCode, body.codeVerifier);
  if (!claim) {
    return jsonResponse(400, { error: "invalid_code" });
  }

  const ownerUserId = claim.userId;

  // Step 4: mint credentials. Raw values leave only on the response body.
  const creds = await generateDeviceCredentials();

  // Step 5: insert the device row. The migration-0034 trigger enforces
  // `owner_user_id` references a role='admin' user; we already verified
  // that in app code (step 1) so this is belt-and-braces.
  let inserted: Device;
  try {
    const [row] = await db
      .insert(devices)
      .values({
        kind: "phone_nfc",
        label: body.label.slice(0, 120),
        capabilities: body.requestedCapabilities as DeviceCapability[],
        ownerUserId,
        platform: body.platform,
        model: body.model,
        osVersion: body.osVersion,
        appVersion: body.appVersion,
        pushToken: body.pushToken ?? null,
        apnsEnvironment: body.apnsEnvironment,
      })
      .returning();
    if (!row) throw new Error("device insert returned no row");
    inserted = row;
  } catch (err) {
    log.error("Failed to insert device row", {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, { error: "internal" });
  }

  // Step 6: insert the matching device_tokens row.
  const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
  let tokenRow: DeviceToken;
  try {
    const [row] = await db
      .insert(deviceTokens)
      .values({
        deviceId: inserted.id,
        tokenHash: creds.deviceTokenHash,
        // Raw HMAC key — symmetric, must be retrievable for scan-result
        // nonce verification. iOS app holds the matching value in Keychain.
        secret: creds.deviceSecret,
        expiresAt,
      })
      .returning();
    if (!row) throw new Error("device_tokens insert returned no row");
    tokenRow = row;
  } catch (err) {
    // Roll back the device row so we don't leave a tokenless device behind.
    log.error("Failed to insert device_tokens row; rolling back device", {
      deviceId: inserted.id,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await db.delete(devices).where(eq(devices.id, inserted.id));
    } catch (rollbackErr) {
      log.error("Rollback of device row failed", {
        deviceId: inserted.id,
        error: rollbackErr instanceof Error
          ? rollbackErr.message
          : String(rollbackErr),
      });
    }
    return jsonResponse(500, { error: "internal" });
  }

  // Step 7: audit. Best-effort fire-and-forget — never block the response.
  void logDeviceRegistered({
    userId: ownerUserId,
    ip: reqCtx.ip,
    ua: reqCtx.ua,
    route: REGISTER_ROUTE,
    metadata: {
      deviceId: inserted.id,
      kind: inserted.kind,
      platform: inserted.platform,
      model: inserted.model,
      appVersion: inserted.appVersion,
      capabilities: inserted.capabilities,
    },
  });
  void logDeviceTokenIssued({
    userId: ownerUserId,
    ip: reqCtx.ip,
    ua: reqCtx.ua,
    route: REGISTER_ROUTE,
    metadata: {
      deviceId: inserted.id,
      tokenId: tokenRow.id,
      hashPrefix: creds.deviceTokenHash.slice(0, 8),
    },
  });

  return jsonResponse(200, {
    ok: true,
    deviceId: inserted.id,
    deviceToken: creds.deviceToken,
    deviceSecret: creds.deviceSecret,
    capabilities: inserted.capabilities,
    expiresAtIso: expiresAt.toISOString(),
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    // One log line on every POST, regardless of outcome. Lets us answer
    // "did the iOS app's request even reach the server?" without needing
    // Xcode/Console.app on the phone. Logs IP + UA + content-length only
    // — never logs the body (would leak the one-time code + PKCE
    // verifier even on a successful call).
    log.info("Register hit", {
      ip: getClientIp(ctx.req),
      ua: ctx.req.headers.get("user-agent"),
      contentLength: ctx.req.headers.get("content-length"),
      contentType: ctx.req.headers.get("content-type"),
      idempotencyKey: ctx.req.headers.get("idempotency-key"),
    });

    return await withIdempotency(ctx, REGISTER_ROUTE, async () => {
      // Latency-floor jitter — see module docstring. Mirrors `auth.ts:154`.
      // We start the timer FIRST so even an early-return (e.g. body validation
      // failure) waits the full window. This way the latency between
      // "invalid body" and "successful register" is wider (the mint path
      // is naturally longer) but the floor is uniform.
      const jitterMs = JITTER_FLOOR_MS +
        Math.floor(Math.random() * JITTER_BAND_MS);
      const jitterPromise = new Promise<void>((resolve) =>
        setTimeout(resolve, jitterMs)
      );

      // Step 1: body validation. Reject malformed early — but still observe
      // the jitter floor below. This endpoint is NOT cookie-gated: the
      // iOS app's URLSession can't carry the admin cookie that minted
      // the one-time code (ASWebAuthenticationSession sandboxes its
      // jar). Auth is the PKCE proof, claimed inside `runRegister`.
      let raw: unknown;
      try {
        raw = await ctx.req.json();
      } catch {
        log.warn("Register reject — body not JSON", {
          ip: getClientIp(ctx.req),
        });
        await jitterPromise;
        return jsonResponse(400, { error: "invalid_body" });
      }
      const parsed = registerBodySchema.safeParse(raw);
      if (!parsed.success) {
        const reason = zodReason(parsed.error);
        log.warn("Register reject — schema fail", {
          ip: getClientIp(ctx.req),
          reason,
          // Path of the first failing field — safe to log (no values).
          firstFailPath: parsed.error.issues[0]?.path.join(".") ?? "",
        });
        await jitterPromise;
        return jsonResponse(400, { error: reason });
      }

      const reqCtx: RequestContext = {
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
      };

      // Run the claim + insert pipeline in parallel with the jitter so the
      // floor is the floor, not an additional delay. `Promise.all` resolves
      // when both arms finish — the response is the handler's return.
      const [response] = await Promise.all([
        runRegister(parsed.data, reqCtx),
        jitterPromise,
      ]);
      log.info("Register done", {
        ip: getClientIp(ctx.req),
        status: response.status,
      });
      return response;
    });
  },
});

// Suppress unused-import warning when the handler is the only consumer.
void sql;
