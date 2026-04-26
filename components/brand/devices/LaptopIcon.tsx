import { cn } from "@/src/lib/utils/cn.ts";
import type { DeviceIconProps } from "@/src/lib/utils/device-icons.ts";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: DeviceIconProps["size"]): number {
  return SIZE_MAP[size ?? "md"];
}

/**
 * Laptop tap-target icon — used as the device card's primary status indicator
 * for `kind === "laptop_nfc"` rows.
 *
 * Visual key matches `WallboxIcon.tsx` and `IPhoneIcon.tsx`:
 *   - Matte dark body (lid), rounded top corners.
 *   - Inset halo ring around the lid — status-bearing LED, color comes
 *     from `haloColor`.
 *   - A simple base/keyboard slab below the lid; deliberately neutral so
 *     the halo color reads cleanly.
 */
export function LaptopIcon(
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
      {
        /* Halo outer diffuse glow (LED bleed) — drawn first so the lid
          covers the inner edge */
      }
      <rect
        x="13"
        y="18"
        width="74"
        height="54"
        rx="6"
        ry="6"
        fill="none"
        stroke={haloColor}
        stroke-width="1"
        opacity="0.4"
      />
      {/* Lid body — rounded rectangle, fixed dark grey */}
      <rect
        x="15"
        y="20"
        width="70"
        height="50"
        rx="5"
        ry="5"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Subtle highlight edge */}
      <rect
        x="16"
        y="21"
        width="68"
        height="48"
        rx="4"
        ry="4"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — the status-bearing LED, traced just inside the lid */}
      <rect
        x="18"
        y="23"
        width="64"
        height="44"
        rx="3.5"
        ry="3.5"
        fill="none"
        stroke={haloColor}
        stroke-width="2.5"
        opacity="0.95"
      />
      {/* Screen — darker recessed panel */}
      <rect
        x="22"
        y="26"
        width="56"
        height="38"
        rx="2"
        ry="2"
        fill="oklch(0.18 0.01 250)"
      />
      {/* Camera dot at top center of the screen bezel */}
      <circle cx="50" cy="24" r="0.7" fill="oklch(0.32 0.01 250)" />
      {/* Hinge line under the lid */}
      <rect
        x="13"
        y="70"
        width="74"
        height="2"
        rx="1"
        ry="1"
        fill="oklch(0.18 0.01 250)"
      />
      {/* Base / keyboard slab */}
      <path
        d="M 8 72 L 92 72 L 88 82 Q 87 84 84 84 L 16 84 Q 13 84 12 82 Z"
        fill="oklch(0.32 0.01 250)"
      />
      {/* Trackpad notch on the front edge */}
      <rect
        x="44"
        y="83"
        width="12"
        height="1.2"
        rx="0.6"
        ry="0.6"
        fill="oklch(0.18 0.01 250)"
      />
    </svg>
  );
}
