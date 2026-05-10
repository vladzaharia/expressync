/**
 * ExpresScan v2 / Wave 6 Slice B — server-side capability gate.
 *
 * Two responsibilities:
 *
 *   1. `validateCapabilitySet(caps)` — pure-logic legality check applied
 *      to *app-side* capability sets. Enforces:
 *        - No `'charger'` (apps cannot self-register as chargers; charger
 *          rows are auto-managed by the StEvE sync path and live in
 *          `chargers`, never in `devices`).
 *        - Kiosk legality: when `'kiosk'` is present, the set must
 *          contain *exactly one* of `{scanner, user}`. A multi-capability
 *          kiosk is illegal because kiosk-mode renders a single screen
 *          with no chrome — picking which of {Scan, Chargers} to show
 *          requires unambiguity.
 *        - No duplicate / unknown tokens.
 *
 *      The DB-level CHECK constraint (migration 0037) mirrors the kiosk
 *      rule so a forgotten call site can't slip an illegal set through.
 *
 *   2. `requireCapability(ctx, ...caps)` — middleware-style helper that
 *      throws `CapabilityDeniedError` (status 403) when the bearer-auth'd
 *      device's capability set lacks any of the required tokens. Mirrors
 *      the customer-facing `assertCapability` in `src/lib/capabilities.ts`
 *      (different concept — that one is for customers, this one is for
 *      registered devices).
 *
 * On denial, audits `device.capability.denied` so forensics can spot a
 * device probing for capabilities it doesn't have (e.g. an app that's
 * been demoted from `user` still calling charger-control endpoints).
 */

import type { FreshContext } from "fresh";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
} from "../types/devices.ts";
import { logDeviceCapabilityDenied } from "../audit.ts";
import type { DeviceContext } from "./bearer-auth.ts";

/** Legality result of `validateCapabilitySet`. */
export type CapabilityLegality =
  | { ok: true }
  | { ok: false; reason: string };

const KNOWN_CAPS: ReadonlySet<string> = new Set<string>(DEVICE_CAPABILITIES);

/**
 * Pure-logic legality check for an *app-side* capability set.
 *
 * App-side here means a set produced by the iOS registration picker or by
 * the admin "App Configuration" save. The charger-side capability set
 * (`{charger, scanner}`) is not validated here — it's auto-managed by the
 * StEvE sync path. App-side rejects `'charger'` outright.
 *
 * Rules (in order, first failure short-circuits with a message):
 *   1. Every entry is a known `DeviceCapability` token.
 *   2. No duplicates.
 *   3. Set is non-empty (a device with zero capabilities is dead weight).
 *   4. `'charger'` is forbidden on the app side.
 *   5. When `'kiosk'` is present, exactly one of `{scanner, user}` must
 *      also be present (no zero, no both).
 *
 * Returns `{ ok: true }` on legality; otherwise `{ ok: false, reason }`
 * where `reason` is a stable identifier suitable for surfacing to the
 * client as an error code (e.g. `kiosk_requires_exactly_one_of_scanner_user`).
 */
export function validateCapabilitySet(
  caps: DeviceCapability[],
): CapabilityLegality {
  if (!Array.isArray(caps)) {
    return { ok: false, reason: "capabilities_must_be_array" };
  }
  if (caps.length === 0) {
    return { ok: false, reason: "capabilities_must_not_be_empty" };
  }

  const seen = new Set<string>();
  for (const c of caps) {
    if (typeof c !== "string" || !KNOWN_CAPS.has(c)) {
      return { ok: false, reason: "capability_unknown" };
    }
    if (seen.has(c)) {
      return { ok: false, reason: "capability_duplicate" };
    }
    seen.add(c);
  }

  if (seen.has("charger")) {
    return { ok: false, reason: "capability_not_app_eligible" };
  }

  if (seen.has("kiosk")) {
    const scanner = seen.has("scanner");
    const user = seen.has("user");
    // exactly-one-of: XOR
    if (scanner === user) {
      return {
        ok: false,
        reason: "kiosk_requires_exactly_one_of_scanner_user",
      };
    }
  }

  return { ok: true };
}

/**
 * Thrown by `requireCapability` when the device's capability set is
 * missing one or more required tokens. `status = 403`.
 *
 * The middleware wrapping iOS-bearer routes catches this and emits a
 * 403 JSON body with the missing capability list — the iOS app uses
 * this to decide between "your admin demoted this device" UI vs a
 * generic error.
 */
export class CapabilityDeniedError extends Error {
  readonly status = 403;
  constructor(
    public readonly missing: readonly DeviceCapability[],
    public readonly route: string | null,
  ) {
    super(
      `Device capability denied: missing ${missing.join(", ") || "(none)"}`,
    );
    this.name = "CapabilityDeniedError";
  }
}

/** Minimal Fresh-context shape this helper needs. Easier to fake in tests. */
export interface DeviceCapabilityContext {
  state: { device?: DeviceContext };
  req?: Request;
}

/**
 * Throw `CapabilityDeniedError` (403) when the device's capability set
 * (read from `ctx.state.device.capabilities`, populated by bearer auth)
 * doesn't include *every* required capability.
 *
 * Audits `device.capability.denied` on the throw path so a denied call
 * leaves a trail. The audit write is fire-and-forget and never blocks
 * the throw. Best-effort: an audit-write failure must not break the
 * 403 response.
 *
 * Usage in a route handler (after the `_middleware.ts` bearer auth has
 * populated `ctx.state.device`):
 *
 *   import { requireCapability } from "@/src/lib/devices/capability-gate.ts";
 *   await requireCapability(ctx, "user");
 *   // … handler proceeds knowing the device has the `user` capability
 *
 * If `ctx.state.device` is absent (route reached without bearer auth —
 * a wiring bug), we throw with `missing = caps` and route = null. The
 * middleware in front of every device-bearer route should make this
 * unreachable in practice.
 */
// deno-lint-ignore require-await
export async function requireCapability(
  ctx: DeviceCapabilityContext | FreshContext,
  ...caps: DeviceCapability[]
): Promise<void> {
  const state = (ctx as DeviceCapabilityContext).state ?? {};
  const device = state.device;
  const granted = new Set<string>(device?.capabilities ?? []);
  const missing: DeviceCapability[] = [];
  for (const c of caps) {
    if (!granted.has(c)) missing.push(c);
  }
  if (missing.length === 0) return;

  // best-effort route extraction — same shape as `assertCapability`
  let route: string | null = null;
  try {
    const maybeReq = (ctx as { req?: Request }).req;
    if (maybeReq) route = new URL(maybeReq.url).pathname;
  } catch {
    // ignore — route is metadata, not load-bearing
  }

  // fire-and-forget audit
  void logDeviceCapabilityDenied({
    userId: device?.ownerUserId ?? null,
    route,
    metadata: {
      deviceId: device?.id ?? null,
      required: caps,
      missing,
      granted: Array.from(granted),
    },
  });

  throw new CapabilityDeniedError(missing, route);
}
