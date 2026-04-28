/**
 * Generic device-icon resolver.
 *
 * Until D1 we had `chargerFormFactorIcons` keyed by charger form factor
 * (`wallbox`, `pulsar`, `commander`, `wall_mount`, `generic`). The new
 * Devices admin surface needs to render phones and laptops next to chargers
 * using the *same* icon contract, so callers everywhere now go through
 * `getDeviceIcon(kind, formFactor?)`.
 *
 * Why a single resolver and not three call sites:
 *   - One place to add new device kinds (e.g. `kiosk_nfc` later).
 *   - One place to apply the fallback rule (unknown form factor → generic
 *     charger icon, since it's the most neutral silhouette).
 *   - One place for `DeviceIconProps` to live so the brand icons under
 *     `components/brand/devices/` and the legacy
 *     `components/brand/chargers/` family share a contract.
 *
 * The returned component speaks `DeviceIconProps`. Charger form-factor
 * icons accept the wider `ChargerIconProps` shape, which is structurally a
 * superset (extra `size: number` and `class` aliases) — Preact's function
 * components are contravariant in their props, so the assignment is sound.
 */
import type { ComponentType } from "preact";
import {
  chargerFormFactorIcons,
  GenericChargerIcon,
} from "../../../components/brand/chargers/index.ts";
import { IPhoneIcon } from "../../../components/brand/devices/IPhoneIcon.tsx";
import { LaptopIcon } from "../../../components/brand/devices/LaptopIcon.tsx";
import { TabletIcon } from "../../../components/brand/devices/TabletIcon.tsx";

/**
 * Shared prop contract for every device-style icon (chargers, phones,
 * laptops, future kinds). Intentionally minimal — the device-card layout
 * decides size/halo/className; the icon just renders.
 */
export interface DeviceIconProps {
  /** Token-based size; the icon resolves it to a px number internally. */
  size?: "sm" | "md" | "lg";
  /**
   * Halo ring color. Pass an oklch / hex / Tailwind rgb-var string.
   * The two canonical sources are `STATUS_HALO` (charger UiStatus) and
   * `DEVICE_STATUS_HALO` (generic device status), both in
   * `islands/shared/device-visuals.ts`.
   */
  haloColor?: string;
  /** Extra classes for the outer `<svg>`. */
  className?: string;
}

/**
 * Resolve a device kind (+ optional charger form factor) to the matching
 * brand icon component.
 *
 * Falls back to `GenericChargerIcon` for unknown kinds; charger form
 * factors fall back to `GenericChargerIcon` as well.
 */
export function getDeviceIcon(
  kind: "charger" | "phone_nfc" | "tablet_nfc" | "laptop_nfc",
  formFactor?: string,
): ComponentType<DeviceIconProps> {
  if (kind === "charger") {
    const key = formFactor ?? "generic";
    const icon =
      chargerFormFactorIcons[key as keyof typeof chargerFormFactorIcons];
    return (icon ?? GenericChargerIcon) as ComponentType<DeviceIconProps>;
  }
  if (kind === "phone_nfc") return IPhoneIcon;
  if (kind === "tablet_nfc") return TabletIcon;
  if (kind === "laptop_nfc") return LaptopIcon;
  return GenericChargerIcon as ComponentType<DeviceIconProps>;
}
