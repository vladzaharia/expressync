/**
 * POST /api/auth/scan-pair
 *
 * Customer-facing arm endpoint for the scan-to-login flow. Two pairable
 * targets share one route:
 *
 *   - **charger** (legacy): `{chargeBoxId?: string}` (or auto-pick if there's
 *     exactly one online charger). Inserts `scan-pair:{chargeBoxId}:{code}`
 *     and the StEvE pre-authorize hook intercepts the next OCPP tap.
 *
 *   - **device** (Wave 5): `{pairableType: "device", deviceId}`. Lets the
 *     customer arm an admin's online phone for remote sign-in. Inserts
 *     `device-scan:{deviceId}:{code}` with `purpose: "login"`, publishes
 *     `device.scan.requested`, and fires an APNs push so the phone wakes
 *     up. The admin then taps the customer's card on their phone, which
 *     POSTs `/api/devices/scan-result` and triggers the customer's
 *     `/api/auth/scan-detect` SSE → `scan-login` completion.
 *
 * DELETE releases an armed pairing — bidirectional cancel for devices
 * (publishes `device.scan.cancelled` with `source: "customer"` so the
 * iOS active-scan screen dismisses); silent for chargers (no UI to
 * dismiss on the charger side).
 *
 * Public route — no session required. Rate-limited per IP and globally.
 *
 * Security model:
 *   - Charger pairings are bound to a chargeBoxId so an attacker holding
 *     a leaked pairing code can't intercept an unrelated victim's tap.
 *   - Device pairings are bound to a deviceId. The pairing code itself
 *     is single-use; the customer's HMAC nonce on scan-login is bound
 *     to (idTag, pairingCode, deviceId, t) and replays past 60s are
 *     rejected.
 *   - The device path validates the device is registered, not deleted/
 *     revoked, has the `tap` capability, and is online — same gates the
 *     admin scan-arm endpoint enforces.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { chargersCache } from "../../../src/db/schema.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import { logAuthEvent } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  chargerPairingIdentifier,
  clearDevicePushToken,
  deletePairingRow,
  devicePairingIdentifier,
  findArmedChargerPairing,
  findArmedDevicePairing,
  fireDeviceScanApns,
  generateChargerPairingCode,
  generateDevicePairingCode,
  insertChargerPairingRow,
  insertDevicePairingRow,
  isDeviceOnline,
  loadDeviceForArm,
  PAIRING_TTL_SEC,
  publishDeviceScanCancelled,
  publishDeviceScanRequested,
} from "../../../src/services/scan-arm.service.ts";

const log = logger.child("ScanPair");

const ONLINE_WINDOW_MS = 10 * 60 * 1000; // 10-min "online" window for chargers
// 5/min was too tight: legitimate users re-arm a couple of times during a
// normal sign-in (Cancel → re-pick a target) plus the integration suite
// hammers the endpoint across 10 scenarios in <30s. 30/min still deters
// brute-force without breaking real usage.
const RATE_LIMIT_PER_IP = 30;
const RATE_LIMIT_GLOBAL = 100;

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

/**
 * Resolve `chargeBoxId` either from the body or by picking the unique
 * online charger from `chargers_cache`.
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

interface PairBody {
  pairableType?: unknown;
  chargeBoxId?: unknown;
  deviceId?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const ip = getClientIp(ctx.req);
    const ua = ctx.req.headers.get("user-agent") ?? null;
    if (!await checkRateLimit(`scanpair:ip:${ip}`, RATE_LIMIT_PER_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }
    if (!await checkRateLimit("scanpair:global", RATE_LIMIT_GLOBAL)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    let body: PairBody = {};
    try {
      const raw = await ctx.req.text();
      if (raw.trim() !== "") body = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const pairableType = typeof body.pairableType === "string"
      ? body.pairableType
      : "charger";

    if (pairableType === "device") {
      return await armDevicePath({
        deviceId: typeof body.deviceId === "string" ? body.deviceId.trim() : "",
        ip,
        ua,
      });
    }
    if (pairableType !== "charger") {
      return jsonResponse(400, { error: "invalid_pairableType" });
    }

    // ---- charger path ----
    const inputChargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId
      : null;
    const resolved = await resolveChargeBoxId(inputChargeBoxId);
    if (!resolved.ok) {
      return jsonResponse(resolved.status, { error: resolved.error });
    }
    const chargeBoxId = resolved.chargeBoxId;

    // Single-flight per charger.
    const existing = await findArmedChargerPairing(chargeBoxId);
    if (existing) {
      return jsonResponse(409, { error: "already_armed_for_charger" });
    }

    const pairingCode = generateChargerPairingCode();
    let expiresAt: Date;
    try {
      expiresAt = await insertChargerPairingRow({
        chargeBoxId,
        pairingCode,
        ip,
        ua,
      });
    } catch (err) {
      log.error("Failed to insert charger pairing row", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    void logAuthEvent("scan.paired", {
      ip,
      ua,
      route: "/api/auth/scan-pair",
      metadata: { pairableType: "charger", chargeBoxId },
    });

    return jsonResponse(200, {
      pairingCode,
      pairableType: "charger",
      chargeBoxId,
      expiresInSec: PAIRING_TTL_SEC,
      expiresAtEpochMs: expiresAt.getTime(),
    });
  },

  /**
   * Release an armed pairing before TTL. Body shape:
   *   - charger: { chargeBoxId, pairingCode } (legacy)
   *   - device:  { pairableType: "device", deviceId, pairingCode }
   * Public; (deviceId/chargeBoxId, pairingCode) is the auth token.
   */
  async DELETE(ctx) {
    const ip = getClientIp(ctx.req);
    if (!await checkRateLimit(`scanpair:ip:${ip}`, RATE_LIMIT_PER_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    let body: {
      pairableType?: unknown;
      chargeBoxId?: unknown;
      deviceId?: unknown;
      pairingCode?: unknown;
    } = {};
    try {
      const raw = await ctx.req.text();
      if (raw.trim() !== "") body = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const pairingCode = typeof body.pairingCode === "string"
      ? body.pairingCode.trim()
      : "";
    if (!pairingCode) {
      return jsonResponse(400, { error: "pairingCode required" });
    }

    const pairableType = typeof body.pairableType === "string"
      ? body.pairableType
      : (typeof body.deviceId === "string" ? "device" : "charger");

    if (pairableType === "device") {
      const deviceId = typeof body.deviceId === "string"
        ? body.deviceId.trim()
        : "";
      if (!deviceId) return jsonResponse(400, { error: "deviceId required" });
      const identifier = devicePairingIdentifier(deviceId, pairingCode);
      try {
        await deletePairingRow(identifier);
      } catch (err) {
        log.warn("Failed to release device pairing (idempotent)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Notify the iOS active-scan screen so it dismisses immediately.
      publishDeviceScanCancelled({
        deviceId,
        pairingCode,
        cancelledAt: Date.now(),
        source: "customer",
      });
      void logAuthEvent("scan.released", {
        ip,
        ua: ctx.req.headers.get("user-agent") ?? null,
        route: "/api/auth/scan-pair",
        metadata: { pairableType: "device", deviceId },
      });
      return new Response(null, { status: 204 });
    }

    // charger path
    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId.trim()
      : "";
    if (!chargeBoxId) {
      return jsonResponse(400, { error: "chargeBoxId required" });
    }
    const identifier = chargerPairingIdentifier(chargeBoxId, pairingCode);
    try {
      const deletedCount = await deletePairingRow(identifier);
      void logAuthEvent("scan.released", {
        ip,
        ua: ctx.req.headers.get("user-agent") ?? null,
        route: "/api/auth/scan-pair",
        metadata: {
          pairableType: "charger",
          chargeBoxId,
          existed: deletedCount > 0,
        },
      });
      return new Response(null, { status: 204 });
    } catch (err) {
      log.error("Failed to release charger pairing", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
  },
});

/**
 * Customer remote-login arm against an admin's online phone. Mirrors the
 * device gates from `/api/admin/devices/[id]/scan-arm` (capability +
 * online + not-revoked) but with no session check — the customer owns
 * the binding via the pairing code + HMAC nonce on scan-login.
 */
async function armDevicePath({
  deviceId,
  ip,
  ua,
}: {
  deviceId: string;
  ip: string;
  ua: string | null;
}): Promise<Response> {
  if (!deviceId) {
    return jsonResponse(400, { error: "deviceId required" });
  }

  const device = await loadDeviceForArm(deviceId);
  if (!device) return jsonResponse(404, { error: "not_found" });
  if (device.deletedAt !== null || device.revokedAt !== null) {
    return jsonResponse(410, { error: "device_revoked" });
  }
  if (!device.capabilities.includes("tap")) {
    return jsonResponse(400, { error: "capability_missing" });
  }
  if (!isDeviceOnline(device)) {
    return jsonResponse(409, { error: "device_offline" });
  }

  const existing = await findArmedDevicePairing(deviceId);
  if (existing) {
    return jsonResponse(409, { error: "already_armed_for_device" });
  }

  const pairingCode = generateDevicePairingCode();
  let expiresAt: Date;
  try {
    expiresAt = await insertDevicePairingRow({
      deviceId,
      pairingCode,
      purpose: "login",
      hintLabel: null,
      armedByUserId: null,
    });
  } catch (err) {
    log.warn("Pairing INSERT failed; re-checking for armed", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    const fallback = await findArmedDevicePairing(deviceId);
    if (fallback) {
      return jsonResponse(409, { error: "already_armed_for_device" });
    }
    return jsonResponse(500, { error: "internal" });
  }

  publishDeviceScanRequested({
    deviceId,
    pairingCode,
    purpose: "login",
    expiresAtIso: expiresAt.toISOString(),
    expiresAtEpochMs: expiresAt.getTime(),
    requestedByUserId: null,
    hintLabel: null,
  });

  fireDeviceScanApns({
    device,
    deviceId,
    pairingCode,
    purpose: "login",
    hintLabel: null,
    expiresAtEpochMs: expiresAt.getTime(),
    onDeadToken: () => clearDevicePushToken(deviceId),
  });

  void logAuthEvent("scan.paired", {
    ip,
    ua,
    route: "/api/auth/scan-pair",
    metadata: { pairableType: "device", deviceId },
  });

  return jsonResponse(200, {
    pairingCode,
    pairableType: "device",
    deviceId,
    expiresInSec: PAIRING_TTL_SEC,
    expiresAtEpochMs: expiresAt.getTime(),
  });
}

void sql;
