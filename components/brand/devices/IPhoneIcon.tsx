import { cn } from "@/src/lib/utils/cn.ts";
import type { DeviceIconProps } from "@/src/lib/utils/device-icons.ts";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: DeviceIconProps["size"]): number {
  return SIZE_MAP[size ?? "md"];
}

/**
 * Phone tap-target icon — used for `kind === "phone_nfc"` rows.
 *
 * Literal copy of `WallboxIcon` (same fills, same y/height, same rx/ry,
 * same halo + highlight stroke widths) — only the body width is reduced.
 * Wallbox is 84 wide centred at x=8; phone is 52 wide centred at x=24.
 * Each layer keeps the Wallbox inset from the body edge:
 *   - highlight: +1 inset
 *   - halo glow: +10 inset (stroke-width 2, opacity 0.4)
 *   - halo ring: +11 inset (stroke-width 5, opacity 0.95)
 *   - recessed face: +16 inset
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
      {/* Body — narrower than Wallbox; otherwise identical fill + rx. */}
      <rect
        x="24"
        y="8"
        width="52"
        height="84"
        rx="19"
        ry="19"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Highlight edge. */}
      <rect
        x="25"
        y="9"
        width="50"
        height="82"
        rx="18"
        ry="18"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — status-bearing LED. */}
      <rect
        x="35"
        y="19"
        width="30"
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
        x="34"
        y="18"
        width="32"
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
        x="40"
        y="24"
        width="20"
        height="52"
        rx="10"
        ry="10"
        fill="oklch(0.18 0.01 250)"
      />
    </svg>
  );
}
