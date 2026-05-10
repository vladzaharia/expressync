/**
 * ExpresScan v2 — admin feature-flags PATCH for a user.
 *
 * PATCH /api/admin/users/{userId}/feature-flags
 *   Body (strict): { flags: Array<{ key: string; value: <json> | null }> }
 *
 * Per entry:
 *   - `value: null` deletes the user-level row for `key` (falls back to the
 *     registry default unless a device override is in play).
 *   - Otherwise the value is validated against the registry's Zod schema,
 *     and the row is upserted with `updated_by = "admin:{adminUserId}"`.
 *
 * Validation rules:
 *   - `key` must exist in `FEATURE_FLAGS`.
 *   - `value` must satisfy the flag's Zod schema (when not `null`).
 *   - The flag's `scope` must be `"user"` or `"both"`.
 *
 * On success:
 *   - Emits `device.feature-flags.changed` (one event per flag-eligible
 *     device owned by `userId`). Charger-kind devices are excluded by
 *     virtue of the `kind IN ('phone_nfc','tablet_nfc','laptop_nfc')`
 *     check on the `devices` table; we filter via the registry helper
 *     for clarity.
 *   - Audits `user.feature_flags.changed` with the changed keys/values.
 *
 * Auth: admin cookie. Bearer is rejected upstream.
 *
 * Errors:
 *   401 unauthorized                no cookie session
 *   403 forbidden                   non-admin role
 *   400 invalid_body                Zod failure
 *   400 invalid_flag                unknown key
 *   400 invalid_value               Zod failure for the per-flag value
 *   400 invalid_scope               flag is `device`-scoped only
 *   404 user_not_found              unknown userId
 *   500 internal_error              storage / SSE wiring failure
 */

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import {
  devices,
  userFeatureFlagValues,
  users,
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
import { logAdminUserFeatureFlagsChanged } from "../../../../../src/lib/audit.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminUserFeatureFlagsPatch");
const ROUTE = "/api/admin/users/[userId]/feature-flags";

interface UserRow {
  id: string;
}

interface OwnedDeviceRow {
  id: string;
  kind: string;
  deletedAt: Date | null;
}

// Test seams.
type UserLoader = (userId: string) => Promise<UserRow | null>;
type OwnedDevicesLoader = (userId: string) => Promise<OwnedDeviceRow[]>;
type UserFlagUpserter = (
  userId: string,
  rows: {
    key: FeatureFlag;
    value: unknown;
    updatedAt: Date;
    updatedBy: string;
  }[],
) => Promise<void>;
type UserFlagDeleter = (userId: string, keys: FeatureFlag[]) => Promise<void>;
type FlagResolver = (
  userId: string,
  deviceId: string | null,
) => Promise<Record<string, unknown>>;

const defaultUserLoader: UserLoader = async (userId) => {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
};

const defaultOwnedDevicesLoader: OwnedDevicesLoader = async (userId) => {
  const rows = await db
    .select({
      id: devices.id,
      kind: devices.kind,
      deletedAt: devices.deletedAt,
    })
    .from(devices)
    .where(eq(devices.ownerUserId, userId));
  return rows;
};

const defaultUserFlagUpserter: UserFlagUpserter = async (userId, rows) => {
  for (const r of rows) {
    await db
      .insert(userFeatureFlagValues)
      .values({
        userId,
        flagKey: r.key,
        valueJson: r.value as never,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })
      .onConflictDoUpdate({
        target: [userFeatureFlagValues.userId, userFeatureFlagValues.flagKey],
        set: {
          valueJson: r.value as never,
          updatedAt: r.updatedAt,
          updatedBy: r.updatedBy,
        },
      });
  }
};

const defaultUserFlagDeleter: UserFlagDeleter = async (userId, keys) => {
  if (keys.length === 0) return;
  await db
    .delete(userFeatureFlagValues)
    .where(
      and(
        eq(userFeatureFlagValues.userId, userId),
        inArray(userFeatureFlagValues.flagKey, keys as string[]),
      ),
    );
};

const defaultFlagResolver: FlagResolver = async (userId, deviceId) => {
  const m = await resolveFlags(userId, deviceId);
  // Flatten resolver wire shape to `{key: value}` for the response.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v.value;
  return out;
};

let userLoader: UserLoader = defaultUserLoader;
let ownedDevicesLoader: OwnedDevicesLoader = defaultOwnedDevicesLoader;
let userFlagUpserter: UserFlagUpserter = defaultUserFlagUpserter;
let userFlagDeleter: UserFlagDeleter = defaultUserFlagDeleter;
let flagResolver: FlagResolver = defaultFlagResolver;

export function _setUserLoaderForTests(fn: UserLoader | null): void {
  userLoader = fn ?? defaultUserLoader;
}
export function _setOwnedDevicesLoaderForTests(
  fn: OwnedDevicesLoader | null,
): void {
  ownedDevicesLoader = fn ?? defaultOwnedDevicesLoader;
}
export function _setUserFlagUpserterForTests(
  fn: UserFlagUpserter | null,
): void {
  userFlagUpserter = fn ?? defaultUserFlagUpserter;
}
export function _setUserFlagDeleterForTests(
  fn: UserFlagDeleter | null,
): void {
  userFlagDeleter = fn ?? defaultUserFlagDeleter;
}
export function _setFlagResolverForTests(fn: FlagResolver | null): void {
  flagResolver = fn ?? defaultFlagResolver;
}
export function _resetUserFeatureFlagsTestSeams(): void {
  userLoader = defaultUserLoader;
  ownedDevicesLoader = defaultOwnedDevicesLoader;
  userFlagUpserter = defaultUserFlagUpserter;
  userFlagDeleter = defaultUserFlagDeleter;
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

    const userId = ctx.params.userId;
    if (!userId || userId.length < 1 || userId.length > 128) {
      return jsonResponse(404, { error: "user_not_found" });
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
      // De-dup within the patch (last write wins).
      const seen = new Map<string, { key: string; value: unknown }>();
      for (const f of parsed.flags) seen.set(f.key, f);

      for (const f of seen.values()) {
        if (!isFeatureFlag(f.key)) {
          return jsonResponse(400, {
            error: "invalid_flag",
            key: f.key,
          });
        }
        const spec = FEATURE_FLAGS[f.key];
        const scope = getFeatureFlagScope(f.key);
        if (scope !== "user" && scope !== "both") {
          return jsonResponse(400, {
            error: "invalid_scope",
            key: f.key,
            scope,
          });
        }
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

      // Confirm the user exists before touching storage.
      let user: UserRow | null;
      try {
        user = await userLoader(userId);
      } catch (err) {
        log.error("user load failed", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }
      if (!user) return jsonResponse(404, { error: "user_not_found" });

      try {
        if (upserts.length > 0) await userFlagUpserter(userId, upserts);
        if (deletes.length > 0) await userFlagDeleter(userId, deletes);
      } catch (err) {
        log.error("user feature-flag write failed", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }

      const changedKeys: FeatureFlag[] = [
        ...upserts.map((u) => u.key),
        ...deletes,
      ];

      // Fan-out SSE to every flag-eligible device the user owns.
      let devicesOwned: OwnedDeviceRow[] = [];
      try {
        devicesOwned = await ownedDevicesLoader(userId);
      } catch (err) {
        log.warn("owned-devices lookup failed (non-fatal)", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      for (const d of devicesOwned) {
        if (d.deletedAt !== null) continue;
        if (!isFeatureFlagEligibleKind(d.kind)) continue;
        try {
          publishDeviceFeatureFlagsChanged(d.id, changedKeys);
        } catch (err) {
          log.warn("SSE publish failed (non-fatal)", {
            deviceId: d.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      void logAdminUserFeatureFlagsChanged({
        userId: adminUserId,
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
        route: ROUTE,
        metadata: {
          targetUserId: userId,
          scope: "user",
          changedKeys,
          values: Object.fromEntries([
            ...upserts.map((u) => [u.key, u.value] as const),
            ...deletes.map((k) => [k, null] as const),
          ]),
          changedByUserId: adminUserId,
        },
      });

      // Build the post-write effective user-level flag map for the
      // response. We resolve with `deviceId: null` so the result is
      // user-scoped (no device override layer); callers that need a
      // device-effective view should hit the device endpoint.
      let effective: Record<string, unknown> = {};
      try {
        effective = await flagResolver(userId, null);
      } catch (err) {
        log.warn("post-write resolver failed (non-fatal)", {
          userId,
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
