/**
 * ExpresScan v2 / Wave 6 Slice D — kind-aware capability option lists.
 *
 * The capability picker on `/admin/devices/:id` (and the iOS
 * registration picker, by parallel construction in slice E/H) renders
 * a different set of editable options depending on the device row's
 * `kind`:
 *
 *   - `phone_nfc` / `tablet_nfc` / `laptop_nfc` (app devices) —
 *       editable: `{scanner, user, kiosk}`. `charger` is never legal
 *       on an app row (rejected by `validateCapabilitySet`).
 *
 *   - `charger` rows — synthetic; surfaced via the
 *       `tappable_devices` view from `chargers`, never edited
 *       through the devices admin. The picker on a charger detail
 *       page (if and when we surface one) shows `charger` as a
 *       read-only chip + `scanner` as the only editable toggle.
 *       Today chargers don't render the App Configuration tab at all
 *       (the detail page redirects to `/admin/chargers/:id`), but
 *       the helpers below are kind-correct so a future charger-side
 *       configuration tab can reuse them.
 *
 * Plus per-capability friendly metadata (label, description, icon
 * key) so the picker UI can render rows without re-deriving copy in
 * three places. Mirrors the iOS `Sources/Capabilities/Capabilities.swift`
 * registry coming in slice E.
 */

import { type DeviceCapability, type DeviceKind } from "../types/devices.ts";

/** Friendly metadata for a single capability — shown in the picker. */
export interface CapabilityMetadata {
  capability: DeviceCapability;
  /** Short title — "Scanner", "Kiosk mode", etc. */
  label: string;
  /** One-sentence description for the picker tooltip / row sub-text. */
  description: string;
  /** Lookup key for the lucide icon — picker maps it to an icon component. */
  iconKey: "scanner" | "charger" | "user" | "kiosk" | "managed";
}

/**
 * Canonical metadata table. Edit copy here and every surface (admin
 * picker + iOS registration picker, once mirrored) updates.
 */
export const CAPABILITY_METADATA: Record<DeviceCapability, CapabilityMetadata> =
  {
    scanner: {
      capability: "scanner",
      label: "Scanner",
      description:
        "Reads NFC tags for admin-arm scans, customer logins, and card link flows.",
      iconKey: "scanner",
    },
    charger: {
      capability: "charger",
      label: "Charger",
      description:
        "Auto-managed by StEvE sync. Indicates this row is an EV charging station, not an app device.",
      iconKey: "charger",
    },
    user: {
      capability: "user",
      label: "User",
      description:
        "Unlocks the Chargers tab — list, start/stop sessions, and cancel reservations.",
      iconKey: "user",
    },
    kiosk: {
      capability: "kiosk",
      label: "Kiosk",
      description:
        "Single-screen appliance mode — no chrome. Legal only with exactly one of {scanner, user}.",
      iconKey: "kiosk",
    },
    managed: {
      capability: "managed",
      label: "Managed device",
      description:
        "Allows admins to read this device's last-known location and request an on-demand fix. Admin-fleet only — customer-owned devices can never carry this.",
      iconKey: "managed",
    },
  };

/**
 * Capabilities the *registration* picker offers when the device is an
 * app device. Apps cannot self-register as chargers, so `charger` is
 * intentionally absent.
 */
export const APP_REGISTRATION_OPTIONS: readonly DeviceCapability[] = [
  "scanner",
  "user",
  "kiosk",
  "managed",
] as const;

/**
 * Editable + read-only options for a `kind`-aware admin picker.
 *
 *   - `editable`  — toggles the picker may flip on/off.
 *   - `readOnly`  — chips shown in the picker but not editable. Used
 *                   for `charger` on charger rows (auto-managed by
 *                   StEvE sync, never user-editable).
 *
 * The PATCH endpoint enforces these constraints server-side; the UI
 * just hides illegal toggles to avoid trapping the user in a state
 * the server will reject.
 */
export interface PickerOptions {
  editable: readonly DeviceCapability[];
  readOnly: readonly DeviceCapability[];
}

/**
 * Return the picker options for the given device `kind`.
 *
 *   - app kinds (`phone_nfc`, `tablet_nfc`, `laptop_nfc`) →
 *       editable `{scanner, user, kiosk}`, no read-only chips.
 *   - `charger` (synthetic rows) →
 *       editable `{scanner}`, read-only `{charger}`.
 *   - unknown kind → app defaults (forward-compatible).
 */
export function pickerOptionsForKind(kind: DeviceKind | string): PickerOptions {
  if (kind === "charger") {
    return {
      editable: ["scanner"],
      readOnly: ["charger"],
    };
  }
  // Default to the app-side picker. Covers `phone_nfc`, `tablet_nfc`,
  // `laptop_nfc` and any future app kind without a UI sweep.
  return {
    editable: APP_REGISTRATION_OPTIONS,
    readOnly: [],
  };
}

/** Friendly label for a capability — convenience accessor. */
export function labelFor(capability: DeviceCapability): string {
  return CAPABILITY_METADATA[capability].label;
}
