/**
 * ExpresScan v2 / Wave 6 Slice B — typed registry of `device_settings`
 * keys.
 *
 * The `device_settings` table is intentionally key-value (so adding a
 * setting doesn't require a migration), but every key the iOS app /
 * web admin reads or writes is enumerated here with a per-key Zod
 * validator + default. The upcoming sync endpoint (slice C) uses this
 * registry to:
 *
 *   - Reject unknown keys outright (no silent persistence of
 *     mistyped / spoofed keys).
 *   - Validate the value shape per key.
 *   - Surface a default to GET callers when the row doesn't exist.
 *
 * Adding a new setting:
 *   1. Add an entry to `SETTING_KEYS` below with a Zod schema +
 *      default.
 *   2. Mirror it in the iOS `Sources/DeviceSync/SettingKey.swift`
 *      registry (slice E).
 *   3. Surface the editor in the web admin "App Configuration" tab
 *      (slice D).
 *
 * Strict-mode Zod everywhere (`.strict()` on objects). Reject unknown
 * fields so a typo'd mobile-side property doesn't silently round-trip
 * through the LWW merge.
 */

import { z } from "zod";
import type { SettingDelta } from "./lww.ts";

/** A single key's schema + default. */
export interface SettingKeySpec<V = unknown> {
  /** Zod validator for the value payload. */
  schema: z.ZodType<V>;
  /** Default returned when the key has no row. */
  defaultValue: V;
  /** Free-text description — used by the admin UI tooltip. */
  description: string;
}

/**
 * Canonical registry. Keys use dot-namespacing (`scope.feature`) so
 * future grouping (e.g. all `notifications.*` keys) is trivial.
 */
export const SETTING_KEYS = {
  /**
   * Human-friendly label shown in admin lists + the device's own UI.
   * Mirrors `devices.label` at registration time but lives here so the
   * device can update it without an admin round-trip.
   */
  "device.label": {
    schema: z.string().min(1).max(120),
    defaultValue: "",
    description:
      "Human-friendly label shown in admin lists and the device's own UI.",
  },
  /**
   * Whether the device wants APNs pushes for scan-arm events. When
   * false, the device still receives the events via SSE while
   * foregrounded — this only suppresses background pushes.
   */
  "notifications.scanRequest": {
    schema: z.boolean(),
    defaultValue: true,
    description: "Receive APNs push when an admin arms a scan on this device.",
  },
} as const satisfies Record<string, SettingKeySpec>;

/** Type-level enumeration of every registered key. */
export type SettingKey = keyof typeof SETTING_KEYS;

/** All registered keys as a runtime-iterable list. */
export const SETTING_KEY_NAMES: readonly SettingKey[] = Object.keys(
  SETTING_KEYS,
) as SettingKey[];

const SETTING_KEY_SET: ReadonlySet<string> = new Set(SETTING_KEY_NAMES);

/** Type guard — narrows an arbitrary string to a known `SettingKey`. */
export function isSettingKey(k: string): k is SettingKey {
  return SETTING_KEY_SET.has(k);
}

/**
 * Wire-shape Zod schema for a single client-supplied delta entry.
 *
 * Strict object — unknown fields rejected. The `value` field is
 * `unknown` here because per-key validation happens in
 * `parseSettingDelta` after we know which key it is.
 */
const SETTING_DELTA_WIRE = z.object({
  key: z.string(),
  value: z.unknown(),
  clientUpdatedAt: z.union([z.string(), z.date()]),
  updatedBy: z.string().min(1).max(120),
}).strict();

/**
 * Parse + validate the client-supplied delta array.
 *
 * Two-phase validation:
 *   1. Wire-shape check (every entry is `{key, value, clientUpdatedAt,
 *      updatedBy}` — no extras).
 *   2. Per-key value check via the registered Zod schema. Unknown keys
 *      are rejected outright.
 *
 * `clientUpdatedAt` is accepted as either an ISO string or a `Date`
 * and normalized to `Date`. Invalid timestamps are rejected.
 *
 * Throws `z.ZodError` on validation failure — the caller (slice C
 * sync endpoint) translates that into a 400 with the field path.
 */
export function parseSettingDelta(deltas: unknown): SettingDelta[] {
  const arr = z.array(SETTING_DELTA_WIRE).parse(deltas);
  const out: SettingDelta[] = [];
  for (const [i, raw] of arr.entries()) {
    if (!isSettingKey(raw.key)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: [i, "key"],
          message: `unknown setting key: ${raw.key}`,
          input: raw.key,
        },
      ]);
    }
    const spec = SETTING_KEYS[raw.key] as SettingKeySpec;
    let value: unknown;
    try {
      value = spec.schema.parse(raw.value);
    } catch (err) {
      if (err instanceof z.ZodError) {
        // Re-issue with the array index prefix so the caller can map
        // the error path back to the offending delta.
        throw new z.ZodError(
          err.issues.map((issue) => ({
            ...issue,
            path: [i, "value", ...issue.path],
          })),
        );
      }
      throw err;
    }
    const clientUpdatedAt = raw.clientUpdatedAt instanceof Date
      ? raw.clientUpdatedAt
      : new Date(raw.clientUpdatedAt);
    if (Number.isNaN(clientUpdatedAt.getTime())) {
      throw new z.ZodError([
        {
          code: "custom",
          path: [i, "clientUpdatedAt"],
          message: "invalid timestamp",
          input: raw.clientUpdatedAt,
        },
      ]);
    }
    out.push({
      key: raw.key,
      value,
      clientUpdatedAt,
      updatedBy: raw.updatedBy,
    });
  }
  return out;
}

/** Look up the default value for a key. Useful for GET responses. */
export function getSettingDefault<K extends SettingKey>(
  key: K,
): (typeof SETTING_KEYS)[K]["defaultValue"] {
  return SETTING_KEYS[key].defaultValue;
}
