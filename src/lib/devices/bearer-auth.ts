/**
 * ExpresScan / Wave 1 Track A — bearer-token resolution for device auth.
 *
 * Single helper used by `routes/_middleware.ts` to validate an
 * `Authorization: Bearer dev_<base64url>` header against the
 * `device_tokens` ⨝ `devices` join. On success, populates a `DeviceContext`
 * for downstream handlers. On failure, audits the probe and returns null
 * (the middleware translates this to a 401).
 *
 * Security properties (see `60-security.md` §1, §3, §4, §11):
 *   - Token is sha256-hashed before lookup; the raw value is never logged
 *     or persisted in cleartext. Only the hash is in `device_tokens`.
 *   - Lookup filters revoked tokens, expired tokens, and soft-deleted
 *     devices. A revoked-and-now-revoked-elsewhere token returns null.
 *   - `last_used_at` is bumped fire-and-forget so the lookup latency
 *     stays bounded even when the DB write is slow.
 *   - On a miss, we audit `device.token.invalid` with the first 8 hex
 *     chars of the token hash + the IP/UA. Loud probes leave a trail
 *     without dragging full secrets into the audit table.
 */

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { devices, deviceTokens } from "../../db/schema.ts";
import { logDeviceTokenInvalid } from "../audit.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child("DeviceBearerAuth");

/** Subset of `device_tokens` ⨝ `devices` that the middleware needs. */
export interface DeviceContext {
  id: string;
  ownerUserId: string;
  capabilities: string[];
  secretHash: string;
  tokenId: string;
}

/** Compute the lowercase hex sha256 of an ASCII / UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const view = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

/** Extract the `dev_…` token from the request, or null if the header is absent / malformed. */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const raw = auth.slice("Bearer ".length).trim();
  // The literal `dev_` prefix is required so the middleware can route
  // on the header without a database round-trip on every cookie request.
  if (!raw.startsWith("dev_")) return null;
  // Reject pathological inputs (defense vs index-blow-up + SQL paramater bloat).
  if (raw.length < 6 || raw.length > 256) return null;
  return raw;
}

/**
 * Resolve a bearer header to a `DeviceContext`, or null on miss.
 *
 * Logs the miss as `device.token.invalid` so probes are detectable. The
 * caller (middleware) translates null to a 401 response.
 */
export async function resolveBearer(
  req: Request,
  meta: { ip: string; ua: string | null; route: string },
): Promise<DeviceContext | null> {
  const raw = extractBearerToken(req);
  if (!raw) return null;

  const hash = await sha256Hex(raw);

  let row:
    | {
      tokenId: string;
      deviceId: string;
      ownerUserId: string;
      capabilities: string[] | null;
      secretHash: string;
    }
    | undefined;
  try {
    const rows = await db
      .select({
        tokenId: deviceTokens.id,
        deviceId: devices.id,
        ownerUserId: devices.ownerUserId,
        capabilities: devices.capabilities,
        secretHash: deviceTokens.secretHash,
      })
      .from(deviceTokens)
      .innerJoin(devices, eq(deviceTokens.deviceId, devices.id))
      .where(and(
        eq(deviceTokens.tokenHash, hash),
        isNull(deviceTokens.revokedAt),
        gt(deviceTokens.expiresAt, sql`now()`),
        isNull(devices.deletedAt),
      ))
      .limit(1);
    row = rows[0];
  } catch (err) {
    // DB outage: fail-closed. Bearer auth must NOT fail-open the way the
    // rate-limiter does — a missing token row is the entire access gate.
    log.error("Bearer lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!row) {
    // Audit the probe. Best-effort — never block the response on it.
    void logDeviceTokenInvalid({
      ip: meta.ip,
      ua: meta.ua,
      route: meta.route,
      metadata: { hashPrefix: hash.slice(0, 8) },
    });
    return null;
  }

  // Bump `last_used_at` non-blocking. We don't await — the lookup is the
  // critical path; a stale `last_used_at` is fine.
  void db
    .update(deviceTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(deviceTokens.id, row.tokenId))
    .catch((err) => {
      log.warn("last_used_at bump failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    id: row.deviceId,
    ownerUserId: row.ownerUserId,
    capabilities: row.capabilities ?? [],
    secretHash: row.secretHash,
    tokenId: row.tokenId,
  };
}
