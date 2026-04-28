/**
 * POST /api/devices/me/state/sync
 *
 * ExpresScan v2 / Wave 6 Slice C — consolidated sync endpoint. Accepts
 * client-side `pendingSettings` (per-key timestamped LWW deltas) and a
 * small diagnostics blob, persists both, then returns the same envelope
 * as `GET /me/state`. Hard cutover replacement for the legacy
 * `POST /api/devices/heartbeat`.
 *
 * Algorithm (see plan §"Reconciliation"):
 *   1. Validate body shape (Zod, strict — unknown fields rejected).
 *   2. Per delta: `clampClientUpdatedAt(clientTs, now+5s)` to defeat
 *      future-stamp poisoning.
 *   3. Load current `device_settings` rows.
 *   4. `mergeSettings(localClamped, remote)` (server-wins on tie).
 *   5. UPSERT every merged row whose `(updatedAt, updatedBy)` differs
 *      from the existing row.
 *   6. Persist diagnostics into `devices.last_status` JSONB; bump
 *      `last_seen_at = now()`.
 *   7. Return `buildDeviceStateEnvelope(deviceId)`.
 *
 * Idempotency: wrapped in `withIdempotency`. A retry with the same
 * `Idempotency-Key` returns the cached envelope without re-applying
 * deltas — important so a client retry can't undo a server-side admin
 * write that landed in between.
 *
 * Errors:
 *   - 400 invalid_body — schema rejection (unknown field, bad type,
 *                         unknown setting key, invalid timestamp).
 *   - 401 unauthorized — middleware miss (defense-in-depth).
 *   - 410 device_deleted — soft-delete race.
 *   - 500 internal — DB / unknown.
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices, deviceSettings } from "../../../../../src/db/schema.ts";
import {
  buildDeviceStateEnvelope,
  DeviceDeletedError,
} from "../../../../../src/lib/devices/device-state.ts";
import {
  clampClientUpdatedAt,
  mergeSettings,
  type SettingDelta,
  type SettingRow,
} from "../../../../../src/lib/devices/lww.ts";
import { parseSettingDelta } from "../../../../../src/lib/devices/settings-keys.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceMeStateSync");

const SYNC_ROUTE = "/api/devices/me/state/sync";

/**
 * Strict diagnostics body. Mirrors the iOS-side `SyncRequest.diagnostics`
 * shape from `you-are-an-expert-lively-eich.md` §"Sync envelope". Every
 * field is required; unknown fields are rejected so a misbehaving client
 * can't silently smuggle metadata into `last_status`.
 */
const PERMISSION_STATES = [
  "authorized",
  "denied",
  "notDetermined",
  "restricted",
  "unavailable",
] as const;

const diagnosticsSchema = z.object({
  // ---- Core (required) -------------------------------------------------
  appVersion: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(64),
  model: z.string().min(1).max(120),
  pushPermission: z.enum([
    "authorized",
    "denied",
    "notDetermined",
    "provisional",
    "ephemeral",
  ]),
  nfcAvailable: z.boolean(),
  pendingUploads: z.number().int().nonnegative().max(10_000),
  reconnectCount: z.number().int().nonnegative().max(1_000_000),

  // ---- Identity / locale (optional, additive Wave 6.1) ----------------
  platform: z.string().min(1).max(64).optional(),
  localizedModel: z.string().min(1).max(120).optional(),
  locale: z.string().min(1).max(64).optional(),
  timezone: z.string().min(1).max(64).optional(),
  apnsEnvironment: z.string().min(1).max(32).optional(),
  pushTokenLast8: z.string().min(1).max(16).optional(),

  // ---- Permissions (granular) -----------------------------------------
  nfcPermission: z.enum(PERMISSION_STATES).optional(),
  backgroundRefreshStatus: z.enum([
    "available",
    "denied",
    "restricted",
  ]).optional(),
  localNetworkPermission: z.enum(PERMISSION_STATES).optional(),

  // ---- Health ----------------------------------------------------------
  batteryLevel: z.number().min(0).max(1).optional(),
  batteryState: z.enum([
    "unknown",
    "unplugged",
    "charging",
    "full",
  ]).optional(),
  lowPowerMode: z.boolean().optional(),
  thermalState: z.enum([
    "nominal",
    "fair",
    "serious",
    "critical",
  ]).optional(),

  // ---- Network ---------------------------------------------------------
  networkInterface: z.string().min(1).max(32).optional(),
  networkIsConstrained: z.boolean().optional(),
  networkIsExpensive: z.boolean().optional(),

  // ---- Storage ---------------------------------------------------------
  diskFreeBytes: z.number().int().nonnegative().optional(),
}).strict();

const syncBodySchema = z.object({
  pendingSettings: z.array(z.unknown()),
  diagnostics: diagnosticsSchema,
}).strict();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Determine which merged rows differ from the pre-merge server state,
 * so we only UPSERT the ones that actually changed (saves write
 * amplification + audit noise).
 */
function diffMergedRows(
  remote: SettingRow[],
  merged: SettingRow[],
): SettingRow[] {
  const byKey = new Map(remote.map((r) => [r.key, r]));
  const out: SettingRow[] = [];
  for (const m of merged) {
    const existing = byKey.get(m.key);
    if (
      !existing ||
      existing.updatedAt.getTime() !== m.updatedAt.getTime() ||
      existing.updatedBy !== m.updatedBy
    ) {
      out.push(m);
    }
  }
  return out;
}

export const handler = define.handlers({
  async POST(ctx) {
    return await withIdempotency(ctx, SYNC_ROUTE, async () => {
      const device = ctx.state.device;
      if (!device) {
        return jsonResponse(401, { error: "unauthorized" });
      }

      // ---- 1. Parse body (strict, unknown fields rejected) ---------------
      let parsed: z.infer<typeof syncBodySchema>;
      try {
        const text = await ctx.req.text();
        const raw = text.trim() === "" ? {} : JSON.parse(text);
        parsed = syncBodySchema.parse(raw);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          });
        }
        return jsonResponse(400, { error: "invalid_body" });
      }

      // ---- 2. Validate per-key deltas via the slice-B registry -----------
      let deltas: SettingDelta[];
      try {
        deltas = parseSettingDelta(parsed.pendingSettings);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues.map((i) => ({
              path: ["pendingSettings", ...i.path],
              message: i.message,
            })),
          });
        }
        return jsonResponse(400, { error: "invalid_body" });
      }

      // ---- 3. Clamp future-stamps ----------------------------------------
      const now = new Date();
      const clamped: SettingDelta[] = deltas.map((d) => ({
        ...d,
        clientUpdatedAt: clampClientUpdatedAt(d.clientUpdatedAt, now),
      }));

      try {
        // ---- 4. Load current settings + verify device row is live ------
        const deviceRows = await db
          .select({
            id: devices.id,
            deletedAt: devices.deletedAt,
          })
          .from(devices)
          .where(eq(devices.id, device.id))
          .limit(1);
        if (!deviceRows[0] || deviceRows[0].deletedAt) {
          return jsonResponse(410, { error: "device_deleted" });
        }

        const remoteRows = await db
          .select({
            key: deviceSettings.key,
            valueJson: deviceSettings.valueJson,
            updatedAt: deviceSettings.updatedAt,
            updatedBy: deviceSettings.updatedBy,
          })
          .from(deviceSettings)
          .where(eq(deviceSettings.deviceId, device.id));

        const remote: SettingRow[] = remoteRows.map((r) => ({
          key: r.key,
          value: r.valueJson as unknown,
          updatedAt: r.updatedAt instanceof Date
            ? r.updatedAt
            : new Date(r.updatedAt as string),
          updatedBy: r.updatedBy,
        }));

        // ---- 5. Merge + UPSERT only the rows that actually changed -----
        const merged = mergeSettings(clamped, remote);
        const toWrite = diffMergedRows(remote, merged);

        if (toWrite.length > 0) {
          for (const row of toWrite) {
            await db.execute(sql`
              INSERT INTO device_settings (device_id, key, value_json, updated_at, updated_by)
              VALUES (
                ${device.id}::uuid,
                ${row.key},
                ${JSON.stringify(row.value)}::jsonb,
                ${row.updatedAt.toISOString()}::timestamptz,
                ${row.updatedBy}
              )
              ON CONFLICT (device_id, key) DO UPDATE SET
                value_json = EXCLUDED.value_json,
                updated_at = EXCLUDED.updated_at,
                updated_by = EXCLUDED.updated_by
            `);
          }
        }

        // ---- 6. Persist diagnostics + bump last_seen_at ----------------
        // Server-side merge with anything already in last_status. We
        // overwrite the documented diagnostics keys (the iOS side owns
        // them) but preserve unknown keys (legacy heartbeat fields,
        // ops-set debug flags) for forward-compat.
        const diagnosticsBlob = {
          ...parsed.diagnostics,
          // pendingUploads/reconnectCount drive `connectivity` in the
          // envelope builder; same name expected there.
        };

        const updateResult = await db.execute<{ id: string }>(sql`
          UPDATE devices
          SET last_seen_at = now(),
              last_status = COALESCE(last_status, '{}'::jsonb)
                            || ${JSON.stringify(diagnosticsBlob)}::jsonb
          WHERE id = ${device.id}::uuid
            AND deleted_at IS NULL
          RETURNING id
        `);
        const affected = (Array.isArray(updateResult)
          ? updateResult
          : (updateResult as { rows?: { id: string }[] }).rows ?? []) as {
            id: string;
          }[];
        if (affected.length === 0) {
          return jsonResponse(410, { error: "device_deleted" });
        }
      } catch (err) {
        if (err instanceof DeviceDeletedError) {
          return jsonResponse(410, { error: "device_deleted" });
        }
        log.error("Sync DB write failed", {
          deviceId: device.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal" });
      }

      // ---- 7. Return the post-merge envelope -----------------------------
      try {
        const envelope = await buildDeviceStateEnvelope(device.id);
        return jsonResponse(200, envelope);
      } catch (err) {
        if (err instanceof DeviceDeletedError) {
          return jsonResponse(410, { error: "device_deleted" });
        }
        log.error("Failed to build envelope after sync", {
          deviceId: device.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal" });
      }
    });
  },
});
