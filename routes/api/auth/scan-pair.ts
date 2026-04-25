/**
 * POST /api/auth/scan-pair
 *
 * Polaris Track C — initiates the scan-to-login pairing flow.
 *
 * Body: { chargeBoxId?: string }
 *   - When omitted: server queries `chargers_cache` for ONLINE chargers.
 *     If exactly 1 exists, server auto-picks it. Otherwise returns 400.
 *
 * Behavior:
 *   1. Resolve chargeBoxId (from body or auto-pick).
 *   2. Reject if there's already an armed pairing for this charger
 *      (only ONE armed pairing per charger at a time → 409 Conflict).
 *   3. Generate pairingCode (16 random bytes, base64url).
 *   4. Insert verifications row:
 *        identifier = "scan-pair:{chargeBoxId}:{pairingCode}"
 *        value      = JSON.stringify({ chargeBoxId, ip, ua, status: "armed" })
 *        expiresAt  = now + 90 seconds
 *   5. Return { pairingCode, chargeBoxId, expiresInSec: 90 }.
 *
 * Public route — no session required. Rate-limited per IP and globally.
 *
 * Security model:
 *   - The pairing is bound to a specific chargeBoxId. Only Docker log
 *     events from THAT charger will be forwarded over the SSE stream.
 *     This prevents the cross-pickup attack where a holder of a valid
 *     pairing code observes an unrelated victim's tap and steals the
 *     login.
 */

import { and, eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { chargersCache, verifications } from "../../../src/db/schema.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import {
  FEATURE_SCAN_LOGIN,
  featureDisabledResponse,
} from "../../../src/lib/feature-flags.ts";
import { logAuthEvent } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ScanPair");

const PAIRING_TTL_SEC = 90;
const ONLINE_WINDOW_MS = 10 * 60 * 1000; // 10-min "online" window
const RATE_LIMIT_PER_IP = 5; // per minute
const RATE_LIMIT_GLOBAL = 100; // per minute (cap on total churn)

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePairingCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Resolve `chargeBoxId` either from the request body or, when absent,
 * by picking the unique online charger from `chargers_cache`.
 *
 * Returns `{ ok: true, chargeBoxId }` on success or `{ ok: false, status,
 * error }` on a failure that should be relayed to the caller.
 */
async function resolveChargeBoxId(
  bodyChargeBoxId: string | null,
): Promise<
  | { ok: true; chargeBoxId: string }
  | { ok: false; status: number; error: string }
> {
  if (bodyChargeBoxId && bodyChargeBoxId.trim() !== "") {
    return { ok: true, chargeBoxId: bodyChargeBoxId.trim() };
  }
  // Auto-pick: query online chargers.
  let rows: { chargeBoxId: string; lastSeenAt: Date | string }[];
  try {
    rows = await db
      .select({
        chargeBoxId: chargersCache.chargeBoxId,
        lastSeenAt: chargersCache.lastSeenAt,
      })
      .from(chargersCache);
  } catch (err) {
    log.error("Failed to query chargers_cache for auto-pick", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 500, error: "internal" };
  }
  const now = Date.now();
  const onlineChargers = rows.filter((r) => {
    const ts = r.lastSeenAt instanceof Date
      ? r.lastSeenAt.getTime()
      : new Date(r.lastSeenAt as string).getTime();
    return isFinite(ts) && (now - ts) <= ONLINE_WINDOW_MS;
  });
  if (onlineChargers.length === 1) {
    return { ok: true, chargeBoxId: onlineChargers[0].chargeBoxId };
  }
  return {
    ok: false,
    status: 400,
    error: onlineChargers.length === 0
      ? "no_chargers_online"
      : "chargeBoxId required",
  };
}

export const handler = define.handlers({
  async POST(ctx) {
    if (!FEATURE_SCAN_LOGIN) {
      return featureDisabledResponse("scan-login");
    }
    const ip = getClientIp(ctx.req);
    if (!await checkRateLimit(`scanpair:ip:${ip}`, RATE_LIMIT_PER_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }
    if (!await checkRateLimit("scanpair:global", RATE_LIMIT_GLOBAL)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    let body: { chargeBoxId?: unknown } = {};
    try {
      const raw = await ctx.req.text();
      if (raw.trim() !== "") {
        body = JSON.parse(raw);
      }
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const inputChargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId
      : null;

    const resolved = await resolveChargeBoxId(inputChargeBoxId);
    if (!resolved.ok) {
      return jsonResponse(resolved.status, { error: resolved.error });
    }
    const chargeBoxId = resolved.chargeBoxId;

    // Reject if an armed pairing already exists for this charger. The
    // verifications.identifier prefix has the chargeBoxId baked in so a
    // simple LIKE + JSON status check is enough.
    try {
      const existing = await db.execute<{ id: string }>(sql`
        SELECT id FROM verifications
        WHERE identifier LIKE ${`scan-pair:${chargeBoxId}:%`}
          AND expires_at > now()
          AND value::jsonb->>'status' = 'armed'
        LIMIT 1
      `);
      const list = Array.isArray(existing)
        ? existing
        : (existing as { rows?: unknown[] }).rows ?? [];
      if (list.length > 0) {
        return jsonResponse(409, { error: "already_armed_for_charger" });
      }
    } catch (err) {
      log.error("Failed armed-pairing precheck", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue — the unique conflict, if any, will surface on insert.
    }

    const pairingCode = generatePairingCode();
    const identifier = `scan-pair:${chargeBoxId}:${pairingCode}`;
    const ua = ctx.req.headers.get("user-agent") ?? null;
    const value = JSON.stringify({ chargeBoxId, ip, ua, status: "armed" });
    const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000);

    try {
      await db.insert(verifications).values({
        id: crypto.randomUUID(),
        identifier,
        value,
        expiresAt,
      });
    } catch (err) {
      log.error("Failed to insert pairing row", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    void logAuthEvent("scan.paired", {
      ip,
      ua,
      route: "/api/auth/scan-pair",
      metadata: { chargeBoxId },
    });

    return jsonResponse(200, {
      pairingCode,
      chargeBoxId,
      expiresInSec: PAIRING_TTL_SEC,
    });
  },

  /**
   * Release an armed pairing before it expires. Called when the user backs
   * out of the scan step in the login wizard — without it the
   * `already_armed_for_charger` guard in POST would block a re-attempt for
   * the remainder of the 90-second TTL, and the charger stays visibly
   * "listening" for a tap the user no longer intends to make.
   *
   * Body: { chargeBoxId: string, pairingCode: string }
   * Public route; the chargeBoxId+pairingCode pair is the auth token.
   */
  async DELETE(ctx) {
    if (!FEATURE_SCAN_LOGIN) {
      return featureDisabledResponse("scan-login");
    }
    const ip = getClientIp(ctx.req);
    if (!await checkRateLimit(`scanpair:ip:${ip}`, RATE_LIMIT_PER_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    let body: { chargeBoxId?: unknown; pairingCode?: unknown } = {};
    try {
      const raw = await ctx.req.text();
      if (raw.trim() !== "") body = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId.trim()
      : "";
    const pairingCode = typeof body.pairingCode === "string"
      ? body.pairingCode.trim()
      : "";
    if (!chargeBoxId || !pairingCode) {
      return jsonResponse(400, { error: "chargeBoxId and pairingCode required" });
    }

    const identifier = `scan-pair:${chargeBoxId}:${pairingCode}`;
    try {
      const deleted = await db
        .delete(verifications)
        .where(eq(verifications.identifier, identifier))
        .returning({ id: verifications.id });
      void logAuthEvent("scan.released", {
        ip,
        ua: ctx.req.headers.get("user-agent") ?? null,
        route: "/api/auth/scan-pair",
        metadata: {
          chargeBoxId,
          existed: deleted.length > 0,
        },
      });
      // Idempotent: if the row was already expired/consumed, still 204.
      return new Response(null, { status: 204 });
    } catch (err) {
      log.error("Failed to release pairing", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
  },
});

// Silence unused-import warning if a future refactor drops the helper.
void and;
