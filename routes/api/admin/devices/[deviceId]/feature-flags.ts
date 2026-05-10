/**
 * ExpresScan v2 — admin feature-flags PATCH for a device.
 *
 * PATCH /api/admin/devices/{deviceId}/feature-flags
 *   Body (strict): { flags: Array<{ key: string; value: <json> | null }> }
 *
 * Same body shape as the per-user endpoint, but writes land in
 * `device_feature_flag_overrides`. Device overrides win over user values.
 *
 * Rejected with **422** when the target device's `kind` is not in
 * `FEATURE_FLAG_DEVICE_KINDS` (i.e. charger). Charger rows are excluded
 * from the override table at the schema level by a BEFORE-INSERT
 * trigger; this route returns a friendlier error before the trigger
 * ever fires.
 *
 * Validation rules:
 *   - `key` must exist in `FEATURE_FLAGS`.
 *   - `value` must satisfy the flag's Zod schema (when not `null`).
 *   - The flag's `scope` must be `"device"` or `"both"`.
 *
 * On success:
 *   - Emits `device.feature-flags.changed` with the changed keys.
 *   - Audits `device.feature_flags.changed`.
 *
 * Auth: admin cookie. Bearer is rejected upstream.
 *
 * Errors:
 *   401 unauthorized                no cookie session
 *   403 forbidden                   non-admin role
 *   400 invalid_body                Zod failure
 *   400 invalid_flag                unknown key
 *   400 invalid_value               Zod failure for the per-flag value
 *   400 invalid_scope               flag is `user`-scoped only
 *   404 not_found                   unknown deviceId
 *   410 device_revoked              soft-deleted row
 *   422 device_kind_unsupported     charger-kind device — overrides
 *                                   not supported
 */

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import {
  deviceFeatureFlagOverrides,
  devices,
} from "../../../../../src/db/schema.ts";
import {
  FEATURE_FLAGS,
  type FeatureFlag,
  getFeatureFlagScope,
  isFeatureFlag,
  isFeatureFlagEligibleKind,
} from "../../../../../src/lib/devices/feature-flags.ts";
import { resolveFlags } from "../../../../../src/lib/devices/feature-flag-resolver.ts";
import { publishDeviceFeatureFlagsChanged } from "../../../../../src/lib/devices/sse-publishers.ts";
import { logAdminDeviceFeatureFlagsChanged } from "../../../../../src/lib/audit.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceFeatureFlagsPatch");
const ROUTE = "/api/admin/devices/[deviceId]/feature-flags";

interface DeviceRow {
  id: string;
  kind: string;
  ownerUserId: string;
  deletedAt: Date | null;
}

// Test seams.
type DeviceLoader = (deviceId: string) => Promise<DeviceRow | null>;
type DeviceFlagUpserter = (
  deviceId: string,
  rows: {
    key: FeatureFlag;
    value: unknown;
    updatedAt: Date;
    updatedBy: string;
  }[],
) => Promise<void>;
type DeviceFlagDeleter = (
  deviceId: string,
  keys: FeatureFlag[],
) => Promise<void>;
type FlagResolver = (
  userId: string,
  deviceId: string | null,
) => Promise<Record<string, unknown>>;

const defaultDeviceLoader: DeviceLoader = async (deviceId) => {
  const [row] = await db
    .select({
      id: devices.id,
      kind: devices.kind,
      ownerUserId: devices.ownerUserId,
      deletedAt: devices.deletedAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return row ?? null;
};

const defaultDeviceFlagUpserter: DeviceFlagUpserter = async (
  deviceId,
  rows,
) => {
  for (const r of rows) {
    await db
      .insert(deviceFeatureFlagOverrides)
      .values({
        deviceId,
        flagKey: r.key,
        valueJson: r.value as never,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })
      .onConflictDoUpdate({
        target: [
          deviceFeatureFlagOverrides.deviceId,
          deviceFeatureFlagOverrides.flagKey,
        ],
        set: {
          valueJson: r.value as never,
          updatedAt: r.updatedAt,
          updatedBy: r.updatedBy,
        },
      });
  }
};

const defaultDeviceFlagDeleter: DeviceFlagDeleter = async (deviceId, keys) => {
  if (keys.length === 0) return;
  await db
    .delete(deviceFeatureFlagOverrides)
    .where(
      and(
        eq(deviceFeatureFlagOverrides.deviceId, deviceId),
        inArray(deviceFeatureFlagOverrides.flagKey, keys as string[]),
      ),
    );
};

const defaultFlagResolver: FlagResolver = async (userId, deviceId) => {
  const m = await resolveFlags(userId, deviceId);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v.value;
  return out;
};

let deviceLoader: DeviceLoader = defaultDeviceLoader;
let deviceFlagUpserter: DeviceFlagUpserter = defaultDeviceFlagUpserter;
let deviceFlagDeleter: DeviceFlagDeleter = defaultDeviceFlagDeleter;
let flagResolver: FlagResolver = defaultFlagResolver;

export function _setDeviceLoaderForTests(fn: DeviceLoader | null): void {
  deviceLoader = fn ?? defaultDeviceLoader;
}
export function _setDeviceFlagUpserterForTests(
  fn: DeviceFlagUpserter | null,
): void {
  deviceFlagUpserter = fn ?? defaultDeviceFlagUpserter;
}
export function _setDeviceFlagDeleterForTests(
  fn: DeviceFlagDeleter | null,
): void {
  deviceFlagDeleter = fn ?? defaultDeviceFlagDeleter;
}
export function _setFlagResolverForTests(fn: FlagResolver | null): void {
  flagResolver = fn ?? defaultFlagResolver;
}
export function _resetDeviceFeatureFlagsTestSeams(): void {
  deviceLoader = defaultDeviceLoader;
  deviceFlagUpserter = defaultDeviceFlagUpserter;
  deviceFlagDeleter = defaultDeviceFlagDeleter;
  flagResolver = defaultFlagResolver;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;
}

const FlagEntrySchema = z.object({
  key: z.string().min(1).max(128),
  value: z.unknown(),
}).strict();

const BodySchema = z.object({
  flags: z.array(FlagEntrySchema).min(1).max(32),
}).strict();

export const handler = define.handlers({
  async PATCH(ctx) {
    if (!ctx.state.user) return jsonResponse(401, { error: "unauthorized" });
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "forbidden" });
    }
    const adminUserId = ctx.state.user.id;

    const deviceId = ctx.params.deviceId;
    if (!deviceId || deviceId.length < 1 || deviceId.length > 64) {
      return jsonResponse(404, { error: "not_found" });
    }

    return await withIdempotency(ctx, ROUTE, async () => {
      let parsed: { flags: { key: string; value: unknown }[] };
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") {
          return jsonResponse(400, { error: "invalid_body" });
        }
        parsed = BodySchema.parse(JSON.parse(text));
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues,
          });
        }
        return jsonResponse(400, { error: "invalid_body" });
      }

      // Load device first — we need its kind to enforce the
      // charger-kind 422 before any per-flag validation.
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
      if (!isFeatureFlagEligibleKind(row.kind)) {
        return jsonResponse(422, {
          error: "device_kind_unsupported",
          message:
            "Feature flag overrides are not supported for charger devices.",
        });
      }

      // Per-flag validation against the registry.
      const upserts: {
        key: FeatureFlag;
        value: unknown;
        updatedAt: Date;
        updatedBy: string;
      }[] = [];
      const deletes: FeatureFlag[] = [];
      const stampedAt = new Date();
      const updatedBy = `admin:${adminUserId}`;
      const seen = new Map<string, { key: string; value: unknown }>();
      for (const f of parsed.flags) seen.set(f.key, f);

      for (const f of seen.values()) {
        if (!isFeatureFlag(f.key)) {
          return jsonResponse(400, { error: "invalid_flag", key: f.key });
        }
        const spec = FEATURE_FLAGS[f.key];
        // All registered flags are scoped "both" since the 2026-05
        // cleanup — every flag is settable at every tier. We retain
        // the `getFeatureFlagScope` call for forward-compat in case
        // future flags reintroduce scope restrictions.
        void getFeatureFlagScope;
        if (f.value === null) {
          deletes.push(f.key);
          continue;
        }
        const result = spec.schema.safeParse(f.value);
        if (!result.success) {
          return jsonResponse(400, {
            error: "invalid_value",
            key: f.key,
            issues: result.error.issues,
          });
        }
        upserts.push({
          key: f.key,
          value: result.data,
          updatedAt: stampedAt,
          updatedBy,
        });
      }

      try {
        if (upserts.length > 0) await deviceFlagUpserter(deviceId, upserts);
        if (deletes.length > 0) await deviceFlagDeleter(deviceId, deletes);
      } catch (err) {
        log.error("device feature-flag write failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }

      const changedKeys: FeatureFlag[] = [
        ...upserts.map((u) => u.key),
        ...deletes,
      ];

      try {
        publishDeviceFeatureFlagsChanged(deviceId, changedKeys);
      } catch (err) {
        log.warn("SSE publish failed (non-fatal)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      void logAdminDeviceFeatureFlagsChanged({
        userId: adminUserId,
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
        route: ROUTE,
        metadata: {
          deviceId,
          ownerUserId: row.ownerUserId,
          scope: "device",
          changedKeys,
          values: Object.fromEntries([
            ...upserts.map((u) => [u.key, u.value] as const),
            ...deletes.map((k) => [k, null] as const),
          ]),
          changedByUserId: adminUserId,
        },
      });

      let effective: Record<string, unknown> = {};
      try {
        effective = await flagResolver(row.ownerUserId, deviceId);
      } catch (err) {
        log.warn("post-write resolver failed (non-fatal)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return jsonResponse(200, {
        ok: true,
        flags: effective,
      });
    });
  },
});
