/**
 * ExpresScan v2 — feature-flag resolver.
 *
 * Pure(-ish) function that, given `(userId, deviceId | null)`, returns
 * the **effective** feature-flag map for that target with default-omit
 * compression: flags whose effective value deep-equals the registry
 * default are excluded so they never leak onto the wire.
 *
 * Precedence (per flag):
 *   device_override ?? user_value ?? registry.defaultValue
 *
 * Charger-kind devices are forbidden from carrying overrides at the
 * schema level (trigger in `drizzle/0051_feature_flags.sql`); we
 * additionally short-circuit the device-override read here for
 * charger-kind devices, which keeps charger envelopes flag-free
 * without an extra DB round-trip.
 *
 * Returned shape mirrors the `device_settings` wire shape on the
 * envelope (`{value, updatedAt, updatedBy}`) so the iOS app can reuse
 * its `DeviceSettingValue` decoder for both rails. Defaults synthesise
 * a `{value, "1970-…", "system:default"}` triple when no row supplies
 * the value but it still differs from the default — in practice this
 * branch never fires (a value differing from the default by definition
 * came from a row), but we synthesise rather than return `undefined`
 * for type-safety.
 *
 * No mutation. The admin PATCH endpoints (separate task) own the
 * UPSERT path; this module is read-only.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  deviceFeatureFlagOverrides,
  devices,
  userFeatureFlagValues,
} from "../../db/schema.ts";
import {
  FEATURE_FLAGS,
  type FeatureFlag,
  isFeatureFlag,
  isFeatureFlagEligibleKind,
} from "./feature-flags.ts";

/**
 * Wire shape for one resolved flag entry. Identical to
 * `device_settings`'s envelope shape so the iOS reader can share its
 * `DeviceSettingValue` decoder.
 */
export interface ResolvedFlagValue {
  value: unknown;
  /** ISO-8601 string. */
  updatedAt: string;
  /**
   * Provenance tag. `admin:{userId}` for admin writes (mirroring
   * `device_settings`); `device:{user|override}` for resolver-internal
   * synthesises (rare).
   */
  updatedBy: string;
}

interface FlagRowReader {
  /** Returns the device's `kind` and `deletedAt`, or `null` if missing. */
  loadDeviceKind(
    deviceId: string,
  ): Promise<{ kind: string; deletedAt: Date | null } | null>;
  loadUserFlags(userId: string): Promise<
    {
      flagKey: string;
      valueJson: unknown;
      updatedAt: Date;
      updatedBy: string;
    }[]
  >;
  loadDeviceFlags(deviceId: string): Promise<
    {
      flagKey: string;
      valueJson: unknown;
      updatedAt: Date;
      updatedBy: string;
    }[]
  >;
}

const defaultReader: FlagRowReader = {
  async loadDeviceKind(deviceId) {
    const [row] = await db
      .select({ kind: devices.kind, deletedAt: devices.deletedAt })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    return row ?? null;
  },
  async loadUserFlags(userId) {
    const rows = await db
      .select({
        flagKey: userFeatureFlagValues.flagKey,
        valueJson: userFeatureFlagValues.valueJson,
        updatedAt: userFeatureFlagValues.updatedAt,
        updatedBy: userFeatureFlagValues.updatedBy,
      })
      .from(userFeatureFlagValues)
      .where(eq(userFeatureFlagValues.userId, userId));
    return rows;
  },
  async loadDeviceFlags(deviceId) {
    const rows = await db
      .select({
        flagKey: deviceFeatureFlagOverrides.flagKey,
        valueJson: deviceFeatureFlagOverrides.valueJson,
        updatedAt: deviceFeatureFlagOverrides.updatedAt,
        updatedBy: deviceFeatureFlagOverrides.updatedBy,
      })
      .from(deviceFeatureFlagOverrides)
      .where(eq(deviceFeatureFlagOverrides.deviceId, deviceId));
    return rows;
  },
};

let activeReader: FlagRowReader = defaultReader;

/**
 * Test seam: swap in a fake reader. Tests should call
 * `_resetFeatureFlagResolverTestSeams()` in their cleanup.
 */
export function _setFeatureFlagReaderForTests(
  fn: FlagRowReader | null,
): void {
  activeReader = fn ?? defaultReader;
}

export function _resetFeatureFlagResolverTestSeams(): void {
  activeReader = defaultReader;
}

/**
 * Resolve the effective feature-flag set for `(userId, deviceId)`.
 *
 * `deviceId` is nullable to support a future user-only resolution path
 * (e.g. an admin pre-flight before the device exists). When non-null
 * and the row's `kind` is not in the phone/tablet/laptop allowlist
 * (i.e. charger), the device-override read is skipped — charger rows
 * carry no flags by contract.
 *
 * Returns an empty object when every effective value equals the
 * registry default. Callers (e.g. `buildDeviceStateEnvelope`) should
 * still omit the `flags` field entirely for charger envelopes; this
 * function happily returns `{}` for chargers but the caller drives the
 * "field absent vs `{}`" decision.
 */
export async function resolveFlags(
  userId: string,
  deviceId: string | null,
): Promise<Record<string, ResolvedFlagValue>> {
  // Look up the device kind once so we know whether to read device
  // overrides. A missing / soft-deleted row is treated as "no device
  // overrides" — the caller (envelope builder) handles
  // missing-device errors separately.
  let readDeviceOverrides = false;
  if (deviceId) {
    const dev = await activeReader.loadDeviceKind(deviceId);
    if (dev && !dev.deletedAt && isFeatureFlagEligibleKind(dev.kind)) {
      readDeviceOverrides = true;
    }
  }

  const userRows = await activeReader.loadUserFlags(userId);
  const userMap = new Map<
    string,
    { value: unknown; updatedAt: Date; updatedBy: string }
  >();
  for (const r of userRows) {
    if (!isFeatureFlag(r.flagKey)) continue; // ignore stale keys not in registry
    userMap.set(r.flagKey, {
      value: r.valueJson,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    });
  }

  const deviceMap = new Map<
    string,
    { value: unknown; updatedAt: Date; updatedBy: string }
  >();
  if (readDeviceOverrides && deviceId) {
    const deviceRows = await activeReader.loadDeviceFlags(deviceId);
    for (const r of deviceRows) {
      if (!isFeatureFlag(r.flagKey)) continue;
      deviceMap.set(r.flagKey, {
        value: r.valueJson,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      });
    }
  }

  const out: Record<string, ResolvedFlagValue> = {};
  for (const flagKey of Object.keys(FEATURE_FLAGS)) {
    const key = flagKey as FeatureFlag;
    const spec = FEATURE_FLAGS[key];

    let source: { value: unknown; updatedAt: Date; updatedBy: string } | null =
      null;
    if (deviceMap.has(key)) {
      source = deviceMap.get(key)!;
    } else if (userMap.has(key)) {
      source = userMap.get(key)!;
    }

    const effective = source ? source.value : spec.defaultValue;

    // Default-omit: if effective value deep-equals default, skip.
    if (deepEqualJson(effective, spec.defaultValue)) continue;

    out[key] = source
      ? {
        value: source.value,
        updatedAt: source.updatedAt.toISOString(),
        updatedBy: source.updatedBy,
      }
      : {
        // Synthetic — only reachable if the registry default itself
        // differs from itself (impossible in practice). Kept for
        // exhaustive-shape correctness.
        value: spec.defaultValue,
        updatedAt: new Date(0).toISOString(),
        updatedBy: "system:default",
      };
  }

  return out;
}

/**
 * Deep-equality check tailored to the JSON value space we accept
 * (primitives, arrays, plain objects). Used for default-omit
 * compression.
 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqualJson(ao[k], bo[k])) return false;
  }
  return true;
}
