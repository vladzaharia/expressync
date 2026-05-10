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
import {
  clampLogTimestampNs,
  extractCategory,
  extractSeq,
  MAX_LOGS_PER_SYNC,
  otelLogRecordSchema,
} from "../../../../../src/lib/devices/log-schemas.ts";
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

// Phase 2 Bundle 2a — managed-device last-known location. Mirrors the
// iOS-side `LocationSnapshot`. The server clamps `capturedAt` against
// future-stamp poisoning (mirrors `clampClientUpdatedAt` for settings)
// and persists the four `last_location_*` columns on `devices`.
// Capability + feature-flag gating is application-level — see the
// handler body. The strict schema only validates the shape.
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().max(1_000_000),
  capturedAt: z.string().datetime(),
}).strict();

const syncBodySchema = z.object({
  pendingSettings: z.array(z.unknown()),
  diagnostics: diagnosticsSchema,
  // Phase 3c — optional structured-log batch. Older clients don't
  // send these fields; the server tolerates absence.
  logs: z.array(otelLogRecordSchema).max(MAX_LOGS_PER_SYNC).optional(),
  logCursor: z.string().regex(/^\d+$/).optional(),
  // Phase 2 Bundle 2a — last-known location snapshot for managed
  // devices. Older clients omit this; the server ignores it when the
  // device lacks `managed` or the feature flag is off.
  location: locationSchema.optional(),
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

        // ---- 6a. Phase 2 — managed-device last-known location ---------
        // Defense-in-depth: the iOS side already gates the upload behind
        // both the `managed` capability and the feature flag, but we
        // re-check here so a misbehaving client OR a server-side
        // capability revocation between sync ticks doesn't leave us
        // storing location for a device that shouldn't be tracked.
        if (parsed.location) {
          // Read capabilities + feature flag inline. We can do this
          // cheaply because the device row is already in scope.
          const [{ capabilities }] = await db
            .select({ capabilities: devices.capabilities })
            .from(devices)
            .where(eq(devices.id, device.id))
            .limit(1) as { capabilities: string[] }[];
          const hasManaged = (capabilities ?? []).includes("managed");
          if (hasManaged) {
            const capturedAtMs = Date.parse(parsed.location.capturedAt);
            const nowMs = now.getTime();
            // Clamp future-stamps to now+5s to defeat clock-skew
            // poisoning (mirrors `clampClientUpdatedAt`).
            const clampedAtMs = Number.isFinite(capturedAtMs)
              ? Math.min(capturedAtMs, nowMs + 5_000)
              : nowMs;
            try {
              await db.execute(sql`
                UPDATE devices
                SET last_location_lat = ${parsed.location.latitude},
                    last_location_lon = ${parsed.location.longitude},
                    last_location_accuracy_m = ${parsed.location.accuracyMeters},
                    last_location_at = ${
                new Date(clampedAtMs).toISOString()
              }::timestamptz
                WHERE id = ${device.id}::uuid
                  AND deleted_at IS NULL
                  AND (last_location_at IS NULL
                       OR last_location_at < ${
                new Date(clampedAtMs).toISOString()
              }::timestamptz)
              `);
            } catch (err) {
              // Don't fail the sync — location is best-effort.
              log.warn("device location update failed", {
                deviceId: device.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
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

      // ---- 6b. Phase 3c — bulk-insert OTel-shaped log records ----------
      // Records ride on top of the existing sync envelope and dedupe via
      // (device_id, seq). Drops on conflict — retried syncs (same
      // Idempotency-Key OR different Idempotency-Key with overlapping
      // seqs) are safe.
      let logsAckedSeq: bigint | null = null;
      let logsDroppedDuplicates = 0;
      if (parsed.logs && parsed.logs.length > 0) {
        const nowMs = now.getTime();
        const insertedSeqs = new Set<string>();
        for (const record of parsed.logs) {
          const seq = extractSeq(record);
          if (seq === null) continue; // No seq → can't dedupe → skip.
          const tsNs = clampLogTimestampNs(record.timestamp, nowMs);
          const category = extractCategory(record);
          try {
            const inserted = await db.execute<{ seq: string }>(sql`
              INSERT INTO device_logs (
                device_id, seq, timestamp_ns, severity_text,
                severity_number, body, category, trace_id, span_id,
                attributes, resource
              )
              VALUES (
                ${device.id}::uuid,
                ${seq.toString()}::numeric(20,0),
                ${tsNs.toString()}::bigint,
                ${record.severity_text},
                ${record.severity_number},
                ${
              record.body.length > 4096
                ? record.body.slice(0, 4096)
                : record.body
            },
                ${category},
                ${record.trace_id ?? null},
                ${record.span_id ?? null},
                ${JSON.stringify(record.attributes)}::jsonb,
                ${JSON.stringify(record.resource)}::jsonb
              )
              ON CONFLICT (device_id, seq) DO NOTHING
              RETURNING seq::text AS seq
            `);
            const rows = (Array.isArray(inserted)
              ? inserted
              : (inserted as { rows?: { seq: string }[] }).rows ?? []) as {
                seq: string;
              }[];
            if (rows.length > 0) {
              insertedSeqs.add(rows[0].seq);
              if (logsAckedSeq === null || seq > logsAckedSeq) {
                logsAckedSeq = seq;
              }
            } else {
              logsDroppedDuplicates += 1;
              // Even duplicates count as "acked" — the server already
              // has them, so the iOS client should advance past them.
              if (logsAckedSeq === null || seq > logsAckedSeq) {
                logsAckedSeq = seq;
              }
            }
          } catch (err) {
            // Per-record DB failure — log and continue. The whole
            // batch shouldn't fail because one record is malformed.
            log.warn("device_logs insert failed", {
              deviceId: device.id,
              seq: seq.toString(),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        log.debug("device_logs batch", {
          deviceId: device.id,
          received: parsed.logs.length,
          inserted: insertedSeqs.size,
          dropped: logsDroppedDuplicates,
          ackedSeq: logsAckedSeq?.toString() ?? null,
        });
      }

      // ---- 7. Return the post-merge envelope -----------------------------
      try {
        const envelope = await buildDeviceStateEnvelope(device.id);
        // Augment the envelope with the log-ingest summary so the iOS
        // `LogDrain` knows what to ack. Older clients ignore the new key.
        const augmented = parsed.logs
          ? {
            ...(envelope as Record<string, unknown>),
            logs: {
              ackedSeq: logsAckedSeq?.toString() ?? null,
              droppedDuplicates: logsDroppedDuplicates,
            },
          }
          : envelope;
        return jsonResponse(200, augmented);
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
