import { cn } from "@/src/lib/utils/cn.ts";
import type { DeviceIconProps } from "@/src/lib/utils/device-icons.ts";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: DeviceIconProps["size"]): number {
  return SIZE_MAP[size ?? "md"];
}

/**
 * Phone tap-target icon — used for `kind === "phone_nfc"` rows.
 *
 * Same fills + halo stroke widths as `WallboxIcon`, but with the body
 * narrowed to 60 wide (centred at x=20) and the corner radii reduced so
 * the silhouette reads as "phone-shaped" rather than a thin wallbox.
 * Inner halo + face widths scale proportionally to Wallbox so the visual
 * weight of the colored ring matches the charger card across the grid.
 */
export function IPhoneIcon(
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
      {/* Body — narrower than Wallbox, less rounded corners. */}
      <rect
        x="20"
        y="8"
        width="60"
        height="84"
        rx="12"
        ry="12"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Highlight edge. */}
      <rect
        x="21"
        y="9"
        width="58"
        height="82"
        rx="11"
        ry="11"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — status-bearing LED. */}
      <rect
        x="28"
        y="19"
        width="44"
        height="62"
        rx="9"
        ry="9"
        fill="none"
        stroke={haloColor}
        stroke-width="5"
        opacity="0.95"
      />
      {/* Halo outer diffuse glow. */}
      <rect
        x="27"
        y="18"
        width="46"
        height="64"
        rx="10"
        ry="10"
        fill="none"
        stroke={haloColor}
        stroke-width="2"
        opacity="0.4"
      />
      {/* Central recessed face. */}
      <rect
        x="32"
        y="24"
        width="36"
        height="52"
        rx="6"
        ry="6"
        fill="oklch(0.18 0.01 250)"
      />
    </svg>
  );
}
