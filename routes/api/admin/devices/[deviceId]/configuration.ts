/**
 * ExpresScan v2 / Wave 6 Slice D — admin App Configuration view-model.
 *
 * GET /api/admin/devices/{deviceId}/configuration
 *
 * Returns the data the "App Configuration" / "Charger Configuration"
 * tab on `/admin/devices/:id` renders against. Composed of:
 *
 *   - device         — id, label, kind, ownerEmail, lastSeenAtIso
 *   - capabilities   — current `devices.capabilities` array
 *   - settings       — full per-key blob with timestamps + actor
 *   - diagnostics    — projection of `devices.last_status` JSONB
 *                      (push permission, NFC permission, reconnect
 *                      count, pending uploads, app/OS/model/etc.)
 *   - recentSyncs    — TODO placeholder; full implementation lands
 *                      with the audit-derived view in a follow-up
 *   - eligibleCapabilityOptions — kind-aware {editable, readOnly}
 *                      from `pickerOptionsForKind` so the UI doesn't
 *                      re-derive the same logic on the client.
 *
 * Auth: admin cookie. Soft-deleted device → 410 (forensic-friendly
 * 200 would be ambiguous; the App Configuration tab shouldn't render
 * editors for a deregistered row).
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import {
  devices,
  deviceSettings,
  users,
} from "../../../../../src/db/schema.ts";
import {
  pickerOptionsForKind,
} from "../../../../../src/lib/devices/capability-metadata.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceConfiguration");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isLikelyUuid(s: string): boolean {
  return s.length >= 8 && s.length <= 64;
}

function toIso(d: Date | string | null): string | null {
  if (d === null || d === undefined) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/**
 * Project the `devices.last_status` JSONB into a stable diagnostics
 * shape. Non-numeric / missing fields fall back to safe defaults so
 * the UI doesn't have to handle nulls in three places.
 */
function projectDiagnostics(
  lastStatus: Record<string, unknown> | null,
  row: {
    lastSeenAt: Date | null;
    appVersion: string | null;
    osVersion: string | null;
    model: string | null;
    platform: string | null;
    pushToken: string | null;
    apnsEnvironment: string | null;
  },
) {
  const ls = lastStatus ?? {};
  const numOr = (k: string, fallback: number): number => {
    const v = ls[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0
      ? Math.floor(v)
      : fallback;
  };
  const stringOr = (k: string, fallback: string | null): string | null => {
    const v = ls[k];
    return typeof v === "string" && v.length > 0 ? v : fallback;
  };
  const boolOr = (k: string, fallback: boolean | null): boolean | null => {
    const v = ls[k];
    return typeof v === "boolean" ? v : fallback;
  };
  return {
    lastSeenAtIso: toIso(row.lastSeenAt),
    reconnectCount: numOr("reconnectCount", 0),
    pendingUploads: numOr("pendingUploads", 0),
    pushPermission: boolOr("pushPermission", null),
    nfcPermission: boolOr("nfcPermission", null),
    appVersion: row.appVersion,
    osVersion: row.osVersion,
    model: row.model,
    platform: row.platform,
    pushTokenLast8: row.pushToken ? row.pushToken.slice(-8) : null,
    apnsEnvironment: row.apnsEnvironment,
    lastErrorMessage: stringOr("lastErrorMessage", null),
  };
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) return jsonResponse(401, { error: "unauthorized" });
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "forbidden" });
    }

    const deviceId = ctx.params.deviceId;
    if (!deviceId || !isLikelyUuid(deviceId)) {
      return jsonResponse(404, { error: "not_found" });
    }

    try {
      const [row] = await db
        .select({
          id: devices.id,
          kind: devices.kind,
          label: devices.label,
          capabilities: devices.capabilities,
          ownerUserId: devices.ownerUserId,
          ownerEmail: users.email,
          ownerName: users.name,
          platform: devices.platform,
          model: devices.model,
          osVersion: devices.osVersion,
          appVersion: devices.appVersion,
          lastSeenAt: devices.lastSeenAt,
          lastStatus: devices.lastStatus,
          registeredAt: devices.registeredAt,
          deletedAt: devices.deletedAt,
          revokedAt: devices.revokedAt,
          pushToken: devices.pushToken,
          apnsEnvironment: devices.apnsEnvironment,
        })
        .from(devices)
        .leftJoin(users, eq(users.id, devices.ownerUserId))
        .where(eq(devices.id, deviceId))
        .limit(1);

      if (!row) return jsonResponse(404, { error: "not_found" });
      if (row.deletedAt !== null) {
        return jsonResponse(410, { error: "device_revoked" });
      }

      const settingsRows = await db
        .select({
          key: deviceSettings.key,
          valueJson: deviceSettings.valueJson,
          updatedAt: deviceSettings.updatedAt,
          updatedBy: deviceSettings.updatedBy,
        })
        .from(deviceSettings)
        .where(eq(deviceSettings.deviceId, deviceId));

      const settings: Record<
        string,
        { value: unknown; updatedAtIso: string; updatedBy: string }
      > = {};
      for (const s of settingsRows) {
        settings[s.key] = {
          value: s.valueJson,
          updatedAtIso: toIso(s.updatedAt) ?? new Date(0).toISOString(),
          updatedBy: s.updatedBy,
        };
      }

      const lastStatus = (row.lastStatus ?? null) as
        | Record<string, unknown>
        | null;

      const options = pickerOptionsForKind(row.kind);

      return jsonResponse(200, {
        device: {
          deviceId: row.id,
          kind: row.kind,
          label: row.label,
          ownerUserId: row.ownerUserId,
          ownerEmail: row.ownerEmail ?? null,
          ownerName: row.ownerName ?? null,
          registeredAtIso: toIso(row.registeredAt),
          lastSeenAtIso: toIso(row.lastSeenAt),
        },
        capabilities: row.capabilities ?? [],
        settings,
        diagnostics: projectDiagnostics(lastStatus, {
          lastSeenAt: row.lastSeenAt,
          appVersion: row.appVersion,
          osVersion: row.osVersion,
          model: row.model,
          platform: row.platform,
          pushToken: row.pushToken,
          apnsEnvironment: row.apnsEnvironment,
        }),
        // TODO(wave6): populate from an audit-derived view of recent
        // `device.state.synced` rows. The DeviceStateSyncList component
        // gates on `recentSyncs.length === 0` so the placeholder is
        // safe to ship empty.
        recentSyncs: [] as Array<{
          syncedAtIso: string;
          changedKeys: string[];
          actor: string;
        }>,
        eligibleCapabilityOptions: {
          editable: options.editable,
          readOnly: options.readOnly,
        },
      });
    } catch (err) {
      log.error("Failed to load configuration view-model", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal_error" });
    }
  },
});
