/**
 * ExpresScan v2 — typed registry of feature flags.
 *
 * Feature flags are runtime toggles the service flips without an app
 * release. Mirrors the `settings-keys.ts` registry pattern: each flag
 * is enumerated here with a per-flag Zod validator + default + scope.
 *
 * Effective value resolution (`feature-flag-resolver.ts`):
 *   `device_override ?? user_value ?? defaultValue`
 *
 * Default-omit on the wire: the envelope's `flags` map only contains
 * flags whose effective value differs from the registry default.
 * Inactive flags never leak into network traffic.
 *
 * Adding a new flag:
 *   1. Add an entry to `FEATURE_FLAGS` below with a Zod schema +
 *      default + scope.
 *   2. Mirror it in the iOS `Sources/DeviceSync/FeatureFlagReader.swift`
 *      consumer (open string-keyed reader, no static type registry).
 *   3. Surface the editor in the admin "Feature Flags" UI (per-user
 *      and/or per-device override).
 *
 * Strict-mode Zod everywhere (`.strict()` on objects). Reject unknown
 * fields so a typo'd admin-side payload doesn't silently round-trip
 * through the resolver.
 */

import { z } from "zod";

/** A single flag's schema + default. */
export interface FeatureFlagSpec<V = unknown> {
  /** Display name (used in admin UI pickers). */
  name: string;
  /** Zod validator for the value payload. */
  schema: z.ZodType<V>;
  /** Default returned when no row supplies a value. */
  defaultValue: V;
  /** Free-text description — used by admin UI tooltip. */
  description: string;
}

/**
 * Canonical registry. Keys use dot-namespacing (`scope.feature`) so
 * future grouping (e.g. all `customer.*` flags) is trivial.
 *
 * Scope is always "both" (user-settable + device-overridable) at the
 * model level. The resolver also reads a global-tier row before the
 * user value, so the effective precedence is:
 *   device override > user value > global default > registry default
 */
export const FEATURE_FLAGS = {
  /**
   * Whether the in-app Connectivity Check card is rendered. Default
   * `true` so first launch surfaces a self-service diagnostic; admins
   * can flip to `false` globally / per-user / per-device when a known
   * issue would have the check stuck red.
   */
  "customer.connectivityCheck": {
    name: "Connectivity Check",
    schema: z.boolean(),
    defaultValue: true,
    description: "Show the Connectivity Check card in Settings.",
  },
} as const satisfies Record<string, FeatureFlagSpec>;

/** Type-level enumeration of every registered flag. */
export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/** All registered flags as a runtime-iterable list. */
export const FEATURE_FLAG_NAMES: readonly FeatureFlag[] = Object.keys(
  FEATURE_FLAGS,
) as FeatureFlag[];

const FEATURE_FLAG_SET: ReadonlySet<string> = new Set(FEATURE_FLAG_NAMES);

/** Type guard — narrows an arbitrary string to a known `FeatureFlag`. */
export function isFeatureFlag(k: string): k is FeatureFlag {
  return FEATURE_FLAG_SET.has(k);
}

/** Look up the default value for a flag. */
export function getFeatureFlagDefault<K extends FeatureFlag>(
  key: K,
): (typeof FEATURE_FLAGS)[K]["defaultValue"] {
  return FEATURE_FLAGS[key].defaultValue;
}

/**
 * Flag scope. Kept as a function returning the literal `"both"` so
 * existing callers (admin UI, PATCH endpoints) compile without
 * touching every site. Every registered flag is settable at every
 * tier (global / user / device override). The picker UI no longer
 * surfaces a scope selector.
 */
export function getFeatureFlagScope(
  _key: FeatureFlag,
): "both" {
  return "both";
}

/**
 * Device kinds eligible to carry feature-flag overrides. Charger-kind
 * rows are excluded at the schema level (trigger in
 * `drizzle/0051_feature_flags.sql`); this constant mirrors the
 * allowlist for application-side checks (resolver short-circuit,
 * admin UI gating).
 */
export const FEATURE_FLAG_DEVICE_KINDS = [
  "phone_nfc",
  "tablet_nfc",
  "laptop_nfc",
] as const;

export type FeatureFlagDeviceKind = typeof FEATURE_FLAG_DEVICE_KINDS[number];

/** True when `kind` is allowed to carry per-device flag overrides. */
export function isFeatureFlagEligibleKind(
  kind: string | null | undefined,
): kind is FeatureFlagDeviceKind {
  return typeof kind === "string" &&
    (FEATURE_FLAG_DEVICE_KINDS as readonly string[]).includes(kind);
}
