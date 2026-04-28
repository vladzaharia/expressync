/**
 * scan-arm.service — shared helpers for the scan-arm flow.
 *
 * Three endpoints participate in arming a tap-to-scan pairing:
 *   - POST /api/admin/devices/[id]/scan-arm  (admin → phone, session-gated)
 *   - POST /api/admin/tag/scan-arm           (admin → charger, session-gated)
 *   - POST /api/auth/scan-pair               (customer → charger or phone,
 *                                             public, rate-limited)
 *
 * Before this module they each redeclared the 90s TTL constant, the
 * pairing-code generator, the verifications-row insert/delete, and the
 * event-bus publish. Now they call through here so drift is impossible.
 *
 * The asymmetry between phones and chargers is intentional and stays:
 *   - Phones are bidirectional. Server pushes via APNs + SSE; the device
 *     posts back the scanned tag (HMAC-signed). Cancel propagates both
 *     ways via `device.scan.cancelled`.
 *   - Chargers are one-way. Server reads StEvE OCPP logs; nothing on the
 *     charger side has a UI to receive a "stop scanning" command. Closing
 *     a charger pairing on the server just removes the verification row;
 *     a tap that lands afterwards falls through to normal authz.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { devices, verifications } from "../db/schema.ts";
import {
  type DeviceScanCancelledPayload,
  type DeviceScanRequestedPayload,
  type ScanPurpose,
} from "../lib/types/devices.ts";
import { eventBus } from "./event-bus.service.ts";
import {
  type ApnsPayload,
  type ApnsResult,
  type ApnsTarget,
  sendApns,
} from "../lib/apns.ts";
import { logger } from "../lib/utils/logger.ts";

const log = logger.child("ScanArmService");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical pairing TTL (seconds). Single source of truth. */
export const PAIRING_TTL_SEC = 90;

/** "Online" cutoff for chargers + devices — matches scan-tap-targets.ts. */
export const ONLINE_WINDOW_MS = 90 * 1000;

// ---------------------------------------------------------------------------
// Pairing-code generators
// ---------------------------------------------------------------------------

/**
 * Charger pairing code: 16 random bytes → base64url. ~22 chars. Used by
 * customer scan-pair + admin charger scan-arm. Long enough that a leaked
 * SSE URL can't be brute-forced.
 */
export function generateChargerPairingCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Device pairing code: 6 chars from a legibility-safe alphabet (no
 * O0Il1L). 30 bits of entropy; single-use + 90s TTL makes brute force
 * infeasible against the rate limits.
 */
const DEVICE_PAIRING_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DEVICE_PAIRING_LEN = 6;

export function generateDevicePairingCode(): string {
  const out: string[] = [];
  const charsetLen = DEVICE_PAIRING_CHARS.length;
  const limit = Math.floor(256 / charsetLen) * charsetLen;
  const buf = new Uint8Array(DEVICE_PAIRING_LEN * 4);
  crypto.getRandomValues(buf);
  for (const byte of buf) {
    if (out.length === DEVICE_PAIRING_LEN) break;
    if (byte >= limit) continue;
    out.push(DEVICE_PAIRING_CHARS[byte % charsetLen]);
  }
  while (out.length < DEVICE_PAIRING_LEN) {
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    if (b[0] >= limit) continue;
    out.push(DEVICE_PAIRING_CHARS[b[0] % charsetLen]);
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Identifier conventions
// ---------------------------------------------------------------------------

export function chargerPairingIdentifier(
  chargeBoxId: string,
  pairingCode: string,
): string {
  return `scan-pair:${chargeBoxId}:${pairingCode}`;
}

export function devicePairingIdentifier(
  deviceId: string,
  pairingCode: string,
): string {
  return `device-scan:${deviceId}:${pairingCode}`;
}

// ---------------------------------------------------------------------------
// Charger arm helpers
// ---------------------------------------------------------------------------

/**
 * Look up an armed charger pairing if one exists. Used by both arm
 * endpoints to enforce single-flight per charger.
 */
export async function findArmedChargerPairing(
  chargeBoxId: string,
): Promise<{ pairingCode: string; expiresAt: Date } | null> {
  try {
    const result = await db.execute<
      { identifier: string; expires_at: string | Date }
    >(sql`
      SELECT identifier, expires_at FROM verifications
      WHERE identifier LIKE ${`scan-pair:${chargeBoxId}:%`}
        AND expires_at > now()
        AND value::jsonb->>'status' = 'armed'
      ORDER BY expires_at DESC
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows ?? [];
    if (rows.length === 0) return null;
    const r = rows[0] as { identifier: string; expires_at: string | Date };
    const prefix = `scan-pair:${chargeBoxId}:`;
    if (!r.identifier.startsWith(prefix)) return null;
    return {
      pairingCode: r.identifier.slice(prefix.length),
      expiresAt: r.expires_at instanceof Date
        ? r.expires_at
        : new Date(r.expires_at),
    };
  } catch (err) {
    log.warn("Armed charger precheck failed", {
      chargeBoxId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Look up an armed device pairing if one exists. Mirrors the charger
 * helper.
 */
export async function findArmedDevicePairing(
  deviceId: string,
): Promise<{ pairingCode: string; expiresAt: Date } | null> {
  try {
    const result = await db.execute<
      { identifier: string; expires_at: string | Date }
    >(sql`
      SELECT identifier, expires_at FROM verifications
      WHERE identifier LIKE ${`device-scan:${deviceId}:%`}
        AND expires_at > now()
        AND value::jsonb->>'status' = 'armed'
      ORDER BY expires_at DESC
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows ?? [];
    if (rows.length === 0) return null;
    const r = rows[0] as { identifier: string; expires_at: string | Date };
    const prefix = `device-scan:${deviceId}:`;
    if (!r.identifier.startsWith(prefix)) return null;
    return {
      pairingCode: r.identifier.slice(prefix.length),
      expiresAt: r.expires_at instanceof Date
        ? r.expires_at
        : new Date(r.expires_at),
    };
  } catch (err) {
    log.warn("Armed device precheck failed", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verification-row insertion
// ---------------------------------------------------------------------------

export interface InsertChargerPairingArgs {
  chargeBoxId: string;
  pairingCode: string;
  ip: string | null;
  ua: string | null;
  /** Optional purpose; defaults to "login" (customer scan-pair). */
  purpose?: ScanPurpose;
  /** When set, the row is stamped with the admin user-id (admin-link arms). */
  adminUserId?: string;
}

export async function insertChargerPairingRow(
  args: InsertChargerPairingArgs,
): Promise<Date> {
  const { chargeBoxId, pairingCode, ip, ua } = args;
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000);
  const identifier = chargerPairingIdentifier(chargeBoxId, pairingCode);
  const value = JSON.stringify({
    chargeBoxId,
    ip,
    ua,
    status: "armed",
    ...(args.purpose ? { purpose: args.purpose } : {}),
    ...(args.adminUserId ? { adminUserId: args.adminUserId } : {}),
  });
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier,
    value,
    expiresAt,
  });
  return expiresAt;
}

export interface InsertDevicePairingArgs {
  deviceId: string;
  pairingCode: string;
  purpose: ScanPurpose;
  hintLabel: string | null;
  /** null when initiated by an unauthenticated customer remote-login. */
  armedByUserId: string | null;
}

export async function insertDevicePairingRow(
  args: InsertDevicePairingArgs,
): Promise<Date> {
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000);
  const identifier = devicePairingIdentifier(args.deviceId, args.pairingCode);
  const value = JSON.stringify({
    deviceId: args.deviceId,
    purpose: args.purpose,
    hintLabel: args.hintLabel,
    status: "armed",
    armedByUserId: args.armedByUserId,
  });
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier,
    value,
    expiresAt,
  });
  return expiresAt;
}

export async function deletePairingRow(identifier: string): Promise<number> {
  const rows = await db
    .delete(verifications)
    .where(eq(verifications.identifier, identifier))
    .returning({ id: verifications.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Event-bus publishers
// ---------------------------------------------------------------------------

export function publishDeviceScanRequested(
  payload: DeviceScanRequestedPayload,
): void {
  try {
    eventBus.publish({ type: "device.scan.requested", payload });
  } catch (err) {
    log.warn("Failed to publish device.scan.requested", {
      deviceId: payload.deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function publishDeviceScanCancelled(
  payload: DeviceScanCancelledPayload,
): void {
  try {
    eventBus.publish({ type: "device.scan.cancelled", payload });
  } catch (err) {
    log.warn("Failed to publish device.scan.cancelled", {
      deviceId: payload.deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// APNs push for an armed device
// ---------------------------------------------------------------------------

export interface DeviceForApns {
  pushToken: string | null;
  apnsEnvironment: string | null;
}

/**
 * Fire APNs push for an armed device-scan, no-await. Best-effort: a slow
 * Apple host never gates the response. Dead tokens (HTTP 410, BadDeviceToken,
 * Unregistered) are cleared so we stop probing them on the next arm.
 */
export function fireDeviceScanApns({
  device,
  deviceId,
  pairingCode,
  purpose,
  hintLabel,
  expiresAtEpochMs,
  onDeadToken,
}: {
  device: DeviceForApns;
  deviceId: string;
  pairingCode: string;
  purpose: ScanPurpose;
  hintLabel: string | null;
  expiresAtEpochMs: number;
  onDeadToken?: () => Promise<void>;
}): void {
  if (
    !device.pushToken ||
    (device.apnsEnvironment !== "sandbox" &&
      device.apnsEnvironment !== "production")
  ) {
    return;
  }
  const target: ApnsTarget = {
    pushToken: device.pushToken,
    environment: device.apnsEnvironment,
  };
  const payload: ApnsPayload = {
    alert: {
      title: purpose === "login" ? "Sign someone in" : "Scan a card now",
      body: hintLabel
        ? `Tap to start the NFC scan: ${hintLabel}`
        : "Tap to start the NFC scan",
    },
    threadId: `device-scan-${deviceId}`,
    collapseId: `scan-${pairingCode}`,
    interruptionLevel: "time-sensitive",
    expirationEpochSec: Math.floor(expiresAtEpochMs / 1000),
    custom: {
      deviceId,
      pairingCode,
      purpose,
      hintLabel,
      expiresAtEpochMs,
    },
  };
  void sendApns(target, payload)
    .then(async (result: ApnsResult) => {
      if (result.ok) return;
      log.warn("APNs send rejected", {
        deviceId,
        pairingCode,
        status: result.status,
        reason: result.reason,
      });
      const dead = result.status === 410 ||
        result.reason === "Unregistered" ||
        result.reason === "BadDeviceToken";
      if (!dead || !onDeadToken) return;
      try {
        await onDeadToken();
        log.info("APNs token cleared after dead-token response", {
          deviceId,
          reason: result.reason,
        });
      } catch (err) {
        log.warn("APNs dead-token clear failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
    .catch((err) => {
      log.warn("APNs send threw", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

// ---------------------------------------------------------------------------
// Device preflight loader
// ---------------------------------------------------------------------------

export interface DevicePreflight {
  id: string;
  ownerUserId: string;
  capabilities: string[];
  pushToken: string | null;
  apnsEnvironment: string | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  revokedAt: Date | null;
}

export async function loadDeviceForArm(
  deviceId: string,
): Promise<DevicePreflight | null> {
  const [row] = await db
    .select({
      id: devices.id,
      ownerUserId: devices.ownerUserId,
      capabilities: devices.capabilities,
      pushToken: devices.pushToken,
      apnsEnvironment: devices.apnsEnvironment,
      lastSeenAt: devices.lastSeenAt,
      deletedAt: devices.deletedAt,
      revokedAt: devices.revokedAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return row ?? null;
}

export function isDeviceOnline(d: DevicePreflight): boolean {
  if (!d.lastSeenAt) return false;
  return (Date.now() - d.lastSeenAt.getTime()) <= ONLINE_WINDOW_MS;
}

export async function clearDevicePushToken(deviceId: string): Promise<void> {
  await db
    .update(devices)
    .set({ pushToken: null, apnsEnvironment: null })
    .where(eq(devices.id, deviceId));
}
