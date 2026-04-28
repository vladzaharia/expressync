import { cn } from "@/src/lib/utils/cn.ts";
import type { DeviceIconProps } from "@/src/lib/utils/device-icons.ts";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: DeviceIconProps["size"]): number {
  return SIZE_MAP[size ?? "md"];
}

/**
 * Tablet tap-target icon — used as the device card's primary status indicator
 * for `kind === "tablet_nfc"` rows.
 *
 * Sits between `IPhoneIcon` (44×84 portrait) and `WallboxIcon` (84×84 square)
 * in the icon family. Same body fill, highlight, halo, and recessed face as
 * both — only the aspect ratio differs (68×84 portrait, slightly chubby).
 *
 * `tablet_nfc` is a reserved kind: only iPhones can register today, but the
 * icon ships now so the UI is ready when iPad registration lands.
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
      {/* Halo outer diffuse glow. */}
      <rect
        x="14"
        y="6"
        width="72"
        height="88"
        rx="14"
        ry="14"
        fill="none"
        stroke={haloColor}
        stroke-width="2"
        opacity="0.4"
      />
      {/* Body — wider portrait rectangle. */}
      <rect
        x="16"
        y="8"
        width="68"
        height="84"
        rx="12"
        ry="12"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Highlight edge. */}
      <rect
        x="17"
        y="9"
        width="66"
        height="82"
        rx="11"
        ry="11"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — status-bearing LED. */}
      <rect
        x="19"
        y="11"
        width="62"
        height="78"
        rx="10"
        ry="10"
        fill="none"
        stroke={haloColor}
        stroke-width="5"
        opacity="0.95"
      />
      {/* Recessed face. */}
      <rect
        x="22"
        y="16"
        width="56"
        height="68"
        rx="6"
        ry="6"
        fill="oklch(0.18 0.01 250)"
      />
    </svg>
  );
}
