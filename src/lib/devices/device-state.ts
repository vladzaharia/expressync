/**
 * ExpresScan v2 / Wave 6 Slice C — DeviceState envelope builder.
 *
 * Single function `buildDeviceStateEnvelope(deviceId)` that composes the
 * full sync envelope returned by `GET /api/devices/me/state` and
 * `POST /api/devices/me/state/sync`. The shape is canonical — it MUST
 * match the iOS `Sources/Models/DeviceState.swift` decoder (slice E)
 * and the contract documented in the wave-6 plan §"Sync envelope".
 *
 * Strict-shape guarantees (security):
 *   - Never echoes `device_tokens.secret` or `secret_hash` (raw HMAC).
 *   - Never echoes `devices.revoked_by_user_id` or `revoked_at`.
 *   - `pushToken` is reduced to `{ last8, environment }` — the raw APNs
 *     token never leaves the server.
 *   - The result is validated through `DeviceStateSchema.parse` at the
 *     return site so a forgotten field can't silently leak.
 *
 * Read-only: this builder never writes. The sync handler does its own
 * UPSERT/UPDATE before calling the builder for the response payload.
 */

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { devices, deviceSettings, users } from "../../db/schema.ts";
import {
  DEVICE_CAPABILITIES,
  DEVICE_KINDS,
  type DeviceCapability,
} from "../types/devices.ts";
import { validateCapabilitySet } from "./capability-gate.ts";

/**
 * Online cutoff for a registered device. Mirrors
 * `routes/api/admin/devices/[deviceId]/scan-arm.ts:ONLINE_WINDOW_MS`.
 */
export const ONLINE_WINDOW_MS = 90 * 1000;

// ---------------------------------------------------------------------------
// Wire shape (Zod) — also exported for handler-side response validation.
// ---------------------------------------------------------------------------

const DEVICE_KIND_ENUM = z.enum(DEVICE_KINDS);
const DEVICE_CAPABILITY_ENUM = z.enum(DEVICE_CAPABILITIES);

const SettingValueSchema = z.object({
  value: z.unknown(),
  updatedAt: z.string(),
  updatedBy: z.string(),
}).strict();

export const DeviceStateSchema = z.object({
  device: z.object({
    id: z.string().uuid(),
    label: z.string(),
    kind: DEVICE_KIND_ENUM,
    ownerUserId: z.string(),
    siteId: z.string().nullable(),
    registeredAt: z.string(),
    lastSeenAt: z.string().nullable(),
  }).strict(),
  capabilities: z.array(DEVICE_CAPABILITY_ENUM),
  kioskAllowed: z.boolean(),
  ownerUser: z.object({
    id: z.string(),
    role: z.enum(["admin", "customer"]),
    displayName: z.string(),
  }).strict(),
  settings: z.record(z.string(), SettingValueSchema),
  scanStatus: z.object({
    armed: z.boolean(),
    pairingCode: z.string().nullable(),
    expiresAt: z.string().nullable(),
  }).strict().nullable(),
  pushToken: z.object({
    last8: z.string(),
    environment: z.enum(["sandbox", "production"]),
  }).strict().nullable(),
  needsPushToken: z.boolean(),
  connectivity: z.object({
    online: z.boolean(),
    lastSyncAt: z.string().nullable(),
    reconnectCount: z.number().int().nonnegative(),
    pendingUploads: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type DeviceStateEnvelope = z.infer<typeof DeviceStateSchema>;

// ---------------------------------------------------------------------------
// Custom error — surfaced to the route layer for 410 mapping.
// ---------------------------------------------------------------------------

export class DeviceDeletedError extends Error {
  readonly status = 410;
  constructor(public readonly deviceId: string) {
    super(`Device ${deviceId} is soft-deleted`);
    this.name = "DeviceDeletedError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * Reduce a raw push token to `{ last8, environment }`. We never echo the
 * full token — last-8 is enough for ops to correlate logs without giving
 * an attacker enough material to spoof an APNs target.
 */
function pushTokenLast8(
  rawToken: string | null,
  environment: string | null,
): { last8: string; environment: "sandbox" | "production" } | null {
  if (!rawToken || !environment) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  return { last8: rawToken.slice(-8), environment };
}

/**
 * Read the diagnostics blob persisted on `devices.last_status` (set by
 * the sync handler) and project the connectivity section. We deliberately
 * keep the source of truth on the device row for now — slice C doesn't
 * add a separate diagnostics table.
 */
function deriveConnectivity(
  lastStatus: Record<string, unknown> | null,
  lastSeenAt: Date | string | null,
): DeviceStateEnvelope["connectivity"] {
  const now = Date.now();
  let online = false;
  let lastSyncAt: string | null = null;
  if (lastSeenAt) {
    const ts = lastSeenAt instanceof Date
      ? lastSeenAt.getTime()
      : new Date(lastSeenAt).getTime();
    if (Number.isFinite(ts)) {
      online = now - ts <= ONLINE_WINDOW_MS;
      lastSyncAt = new Date(ts).toISOString();
    }
  }

  let reconnectCount = 0;
  let pendingUploads = 0;
  if (lastStatus && typeof lastStatus === "object") {
    const r = lastStatus.reconnectCount;
    if (typeof r === "number" && Number.isFinite(r) && r >= 0) {
      reconnectCount = Math.floor(r);
    }
    const p = lastStatus.pendingUploads;
    if (typeof p === "number" && Number.isFinite(p) && p >= 0) {
      pendingUploads = Math.floor(p);
    }
  }
  return { online, lastSyncAt, reconnectCount, pendingUploads };
}

/**
 * Look up the most-recently-armed pairing for this device. Returns
 * `null` if the device lacks the `scanner` capability. Mirrors the
 * `verifications.identifier LIKE 'device-scan:{id}:%'` convention from
 * `routes/api/admin/devices/[deviceId]/scan-arm.ts`.
 */
async function loadScanStatus(
  deviceId: string,
  capabilities: readonly string[],
): Promise<DeviceStateEnvelope["scanStatus"]> {
  if (!capabilities.includes("scanner")) return null;

  const result = await db.execute<{ identifier: string; expires_at: Date }>(sql`
    SELECT identifier, expires_at
    FROM verifications
    WHERE identifier LIKE ${`device-scan:${deviceId}:%`}
      AND expires_at > now()
    ORDER BY expires_at DESC
    LIMIT 1
  `);
  const list =
    (Array.isArray(result)
      ? result
      : (result as { rows?: { identifier: string; expires_at: Date }[] })
        .rows ??
        []) as { identifier: string; expires_at: Date }[];
  const row = list[0];
  if (!row) {
    // No active arm → return a non-null `armed=false` so the iOS app
    // can distinguish "no scanner capability" (null) from "scanner
    // capability but currently idle" (object with armed=false).
    return { armed: false, pairingCode: null, expiresAt: null };
  }
  const prefix = `device-scan:${deviceId}:`;
  const code = row.identifier.startsWith(prefix)
    ? row.identifier.slice(prefix.length)
    : null;
  return {
    armed: true,
    pairingCode: code,
    expiresAt: toIsoOrNull(row.expires_at),
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Compose the full DeviceState envelope for `deviceId`.
 *
 * Throws `DeviceDeletedError` (status 410) when the row is soft-deleted
 * — covers the race window between bearer-auth lookup and this select.
 */
export async function buildDeviceStateEnvelope(
  deviceId: string,
): Promise<DeviceStateEnvelope> {
  const deviceRows = await db
    .select({
      id: devices.id,
      kind: devices.kind,
      label: devices.label,
      capabilities: devices.capabilities,
      ownerUserId: devices.ownerUserId,
      pushToken: devices.pushToken,
      apnsEnvironment: devices.apnsEnvironment,
      lastSeenAt: devices.lastSeenAt,
      lastStatus: devices.lastStatus,
      registeredAt: devices.registeredAt,
      deletedAt: devices.deletedAt,
      ownerName: users.name,
      ownerEmail: users.email,
      ownerRole: users.role,
    })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.ownerUserId))
    .where(eq(devices.id, deviceId))
    .limit(1);

  const row = deviceRows[0];
  if (!row || row.deletedAt) {
    throw new DeviceDeletedError(deviceId);
  }

  const capabilities = (row.capabilities ?? []).filter(
    (c): c is DeviceCapability =>
      (DEVICE_CAPABILITIES as readonly string[]).includes(c),
  );

  // kioskAllowed is "would adding kiosk be legal?". When kiosk is
  // already in the set, "adding" is a no-op so we strip it first to get
  // a stable answer.
  const baseSet = capabilities.filter((c) => c !== "kiosk");
  const kioskAllowed = validateCapabilitySet([...baseSet, "kiosk"]).ok;

  // Settings rows.
  const settingRows = await db
    .select({
      key: deviceSettings.key,
      valueJson: deviceSettings.valueJson,
      updatedAt: deviceSettings.updatedAt,
      updatedBy: deviceSettings.updatedBy,
    })
    .from(deviceSettings)
    .where(eq(deviceSettings.deviceId, deviceId))
    .orderBy(asc(deviceSettings.key));

  const settings: DeviceStateEnvelope["settings"] = {};
  for (const s of settingRows) {
    settings[s.key] = {
      value: s.valueJson as unknown,
      updatedAt: toIso(s.updatedAt),
      updatedBy: s.updatedBy,
    };
  }

  const scanStatus = await loadScanStatus(deviceId, capabilities);
  const pushToken = pushTokenLast8(row.pushToken, row.apnsEnvironment);
  const lastStatus = (row.lastStatus ?? null) as Record<string, unknown> | null;
  const connectivity = deriveConnectivity(lastStatus, row.lastSeenAt);

  // True when the device has granted push permission but hasn't delivered its
  // APNs token to the server yet. The iOS app should respond by calling
  // registerForRemoteNotifications() and PUT-ing the resulting token.
  const ACTIVE_PUSH_PERMS = new Set(["authorized", "provisional", "ephemeral"]);
  const storedPushPerm = lastStatus?.pushPermission;
  const needsPushToken = pushToken === null &&
    typeof storedPushPerm === "string" &&
    ACTIVE_PUSH_PERMS.has(storedPushPerm);

  const displayName = (row.ownerName?.trim() || row.ownerEmail?.trim() ||
    row.ownerUserId).toString();
  const ownerRole: "admin" | "customer" = row.ownerRole === "admin"
    ? "admin"
    : "customer";

  // Bearer-auth'd devices are app-side; charger rows never bearer-auth.
  // An unexpected `kind` is a wiring bug — clamp to the closest legal
  // value rather than 500ing the response.
  const kind = (DEVICE_KINDS as readonly string[]).includes(row.kind)
    ? (row.kind as typeof DEVICE_KINDS[number])
    : "phone_nfc";

  const envelope: DeviceStateEnvelope = {
    device: {
      id: row.id,
      label: row.label,
      kind,
      ownerUserId: row.ownerUserId,
      // `siteId` is not modelled on `devices` today; reserved in the
      // contract for the future multi-site rollout. Always null for now.
      siteId: null,
      registeredAt: toIso(row.registeredAt),
      lastSeenAt: toIsoOrNull(row.lastSeenAt),
    },
    capabilities,
    kioskAllowed,
    ownerUser: {
      id: row.ownerUserId,
      role: ownerRole,
      displayName,
    },
    settings,
    scanStatus,
    pushToken,
    needsPushToken,
    connectivity,
  };

  // Strict-shape gate. If a future schema change leaks a forbidden
  // field into the envelope, this throws before the response goes out.
  return DeviceStateSchema.parse(envelope);
}
