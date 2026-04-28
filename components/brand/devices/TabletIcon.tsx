import { cn } from "@/src/lib/utils/cn.ts";
import type { DeviceIconProps } from "@/src/lib/utils/device-icons.ts";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: DeviceIconProps["size"]): number {
  return SIZE_MAP[size ?? "md"];
}

/**
 * Tablet tap-target icon — used for `kind === "tablet_nfc"` rows.
 *
 * Literal copy of `WallboxIcon` with the body widened. Same fills, same
 * y/height, same rx/ry, same halo + highlight stroke widths. Wallbox is
 * 84 wide; tablet is 92 wide (a couple px wider per side) so it reads as
 * "more rectangle than the wallbox", separating it from the square
 * charger and the narrow phone.
 *
 * Reserved kind: only iPhones register today, but the icon ships now so
 * the UI is ready when iPad registration lands.
 */
export function TabletIcon(
  { size = "md", haloColor = "oklch(0.72 0.14 196)", className }:
    DeviceIconProps,
) {
  const px = resolveSize(size);
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={cn("inline-block", className)}
    >
      {/* Body — wider than Wallbox; otherwise identical fill + rx. */}
      <rect
        x="4"
        y="8"
        width="92"
        height="84"
        rx="19"
        ry="19"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Highlight edge. */}
      <rect
        x="5"
        y="9"
        width="90"
        height="82"
        rx="18"
        ry="18"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — status-bearing LED. */}
      <rect
        x="15"
        y="19"
        width="70"
        height="62"
        rx="13"
        ry="13"
        fill="none"
        stroke={haloColor}
        stroke-width="5"
        opacity="0.95"
      />
      {/* Halo outer diffuse glow. */}
      <rect
        x="14"
        y="18"
        width="72"
        height="64"
        rx="14"
        ry="14"
        fill="none"
        stroke={haloColor}
        stroke-width="2"
        opacity="0.4"
      />
      {/* Central recessed face. */}
      <rect
        x="20"
        y="24"
        width="60"
        height="52"
        rx="10"
        ry="10"
        fill="oklch(0.18 0.01 250)"
      />
    </svg>
  );
}
