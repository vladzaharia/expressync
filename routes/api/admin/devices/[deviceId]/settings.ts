/**
 * ExpresScan v2 / Wave 6 Slice D — admin settings PATCH.
 *
 * PATCH /api/admin/devices/{deviceId}/settings
 *   Body (strict): { settings: SettingDelta[] }   // see settings-keys.ts
 *
 * UPSERTs each delta into `device_settings`. Server stamps:
 *   - `updated_at` = now()
 *   - `updated_by` = `admin:{adminUserId}`
 *
 * Client-supplied `clientUpdatedAt` from the wire is ignored on the
 * admin side — admin writes are always the freshest "as of admin
 * console save". Per-key LWW is still in play on the iOS sync path
 * (slice C), so a phone with a strictly-later `clientUpdatedAt` will
 * still win on its next sync — the admin save is just the new floor.
 *
 * On success:
 *   - Emits `device.settings.changed` SSE so iOS reconciles ≤ ~1s.
 *   - Audits `device.settings.updated` with the changed keys + values.
 *
 * Auth: admin cookie. Bearer is rejected upstream.
 *
 * Errors:
 *   401 unauthorized                         no cookie session
 *   403 forbidden                            non-admin role
 *   400 invalid_body                         Zod failure (incl. unknown key)
 *   404 not_found                            unknown deviceId
 *   410 device_revoked                       soft-deleted row
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices, deviceSettings } from "../../../../../src/db/schema.ts";
import {
  parseSettingDelta,
  type SettingKey,
} from "../../../../../src/lib/devices/settings-keys.ts";
import { publishDeviceSettingsChanged } from "../../../../../src/lib/devices/sse-publishers.ts";
import { logDeviceSettingsUpdated } from "../../../../../src/lib/audit.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceSettingsPatch");
const ROUTE = "/api/admin/devices/[deviceId]/settings";

interface DeviceRow {
  id: string;
  deletedAt: Date | null;
}

interface UpsertedSetting {
  key: SettingKey;
  value: unknown;
  updatedAt: Date;
  updatedBy: string;
}

// Test seams.
type DeviceLoader = (deviceId: string) => Promise<DeviceRow | null>;
type SettingsUpserter = (
  deviceId: string,
  rows: UpsertedSetting[],
) => Promise<void>;

const defaultDeviceLoader: DeviceLoader = async (deviceId) => {
  const [row] = await db
    .select({ id: devices.id, deletedAt: devices.deletedAt })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return row ?? null;
};

const defaultSettingsUpserter: SettingsUpserter = async (deviceId, rows) => {
  // One UPSERT per key — the volume is small (≤ a handful of keys per
  // PATCH) and a single bulk insert with `ON CONFLICT` would force us
  // to switch on each `value` shape because Drizzle's typed values
  // builder isn't happy with a heterogeneous JSONB array.
  for (const r of rows) {
    await db
      .insert(deviceSettings)
      .values({
        deviceId,
        key: r.key,
        valueJson: r.value as never,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })
      .onConflictDoUpdate({
        target: [deviceSettings.deviceId, deviceSettings.key],
        set: {
          valueJson: sql.raw(`EXCLUDED.value_json`),
          updatedAt: sql.raw(`EXCLUDED.updated_at`),
          updatedBy: sql.raw(`EXCLUDED.updated_by`),
        },
      });
  }
};

let deviceLoader: DeviceLoader = defaultDeviceLoader;
let settingsUpserter: SettingsUpserter = defaultSettingsUpserter;

export function _setDeviceLoaderForTests(fn: DeviceLoader | null): void {
  deviceLoader = fn ?? defaultDeviceLoader;
}
export function _setSettingsUpserterForTests(
  fn: SettingsUpserter | null,
): void {
  settingsUpserter = fn ?? defaultSettingsUpserter;
}
export function _resetSettingsPatchTestSeams(): void {
  deviceLoader = defaultDeviceLoader;
  settingsUpserter = defaultSettingsUpserter;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isLikelyUuid(s: string): boolean {
  return s.length >= 8 && s.length <= 64;
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;
}

const BodySchema = z.object({
  settings: z.array(z.unknown()).min(1).max(32),
}).strict();

export const handler = define.handlers({
  async PATCH(ctx) {
    if (!ctx.state.user) return jsonResponse(401, { error: "unauthorized" });
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "forbidden" });
    }
    const adminUserId = ctx.state.user.id;

    const deviceId = ctx.params.deviceId;
    if (!deviceId || !isLikelyUuid(deviceId)) {
      return jsonResponse(404, { error: "not_found" });
    }

    return await withIdempotency(ctx, ROUTE, async () => {
      // Outer envelope: `{ settings: unknown[] }`. Per-entry shape +
      // per-key value validation happens in `parseSettingDelta`.
      let outer: { settings: unknown[] };
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") {
          return jsonResponse(400, { error: "invalid_body" });
        }
        outer = BodySchema.parse(JSON.parse(text));
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues,
          });
        }
        return jsonResponse(400, { error: "invalid_body" });
      }

      // `parseSettingDelta` requires the `updatedBy` field on each
      // entry. Admin saves don't bother the caller with that — we
      // stamp it server-side. So we accept a relaxed shape from the
      // wire (`{ key, value }`) and synthesize the rest.
      const RELAXED = z.object({
        key: z.string(),
        value: z.unknown(),
      }).strict();
      const relaxed: { key: string; value: unknown }[] = [];
      try {
        for (const [i, raw] of outer.settings.entries()) {
          const parsed = RELAXED.parse(raw);
          relaxed.push(parsed);
          // de-dupe within a single PATCH — last one wins (deterministic).
          for (let j = 0; j < i; j++) {
            if (relaxed[j].key === parsed.key) {
              relaxed[j] = parsed;
            }
          }
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues,
          });
        }
        return jsonResponse(400, { error: "invalid_body" });
      }

      // Per-key value validation via the slice-B registry. We reuse
      // `parseSettingDelta` by synthesizing the required envelope
      // fields — guarantees the same gate as the iOS sync path.
      const stampedAt = new Date();
      const updatedBy = `admin:${adminUserId}`;
      let validated;
      try {
        validated = parseSettingDelta(
          relaxed.map((r) => ({
            key: r.key,
            value: r.value,
            clientUpdatedAt: stampedAt.toISOString(),
            updatedBy,
          })),
        );
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues,
          });
        }
        throw err;
      }

      // De-duplicate by key (last-write-wins within this PATCH).
      const dedup = new Map<SettingKey, UpsertedSetting>();
      for (const v of validated) {
        dedup.set(v.key as SettingKey, {
          key: v.key as SettingKey,
          value: v.value,
          updatedAt: stampedAt,
          updatedBy,
        });
      }
      const upserts = Array.from(dedup.values());

      let row: DeviceRow | null;
      try {
        row = await deviceLoader(deviceId);
      } catch (err) {
        log.error("device load failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }
      if (!row) return jsonResponse(404, { error: "not_found" });
      if (row.deletedAt !== null) {
        return jsonResponse(410, { error: "device_revoked" });
      }

      try {
        await settingsUpserter(deviceId, upserts);
      } catch (err) {
        log.error("settings upsert failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }

      const changedKeys = upserts.map((u) => u.key);
      try {
        publishDeviceSettingsChanged(deviceId, changedKeys);
      } catch (err) {
        log.warn("SSE publish failed (non-fatal)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      void logDeviceSettingsUpdated({
        userId: adminUserId,
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
        route: ROUTE,
        metadata: {
          deviceId,
          changedKeys,
          // The two known keys (`device.label`, `notifications.scanRequest`)
          // are non-sensitive, so we record values for forensic value.
          values: Object.fromEntries(upserts.map((u) => [u.key, u.value])),
          changedByUserId: adminUserId,
        },
      });

      return jsonResponse(200, {
        ok: true,
        deviceId,
        changedKeys,
      });
    });
  },
});
