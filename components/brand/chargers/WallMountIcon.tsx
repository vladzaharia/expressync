import { cn } from "@/src/lib/utils/cn.ts";
import type { ChargerIconProps } from "./WallboxIcon.tsx";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: ChargerIconProps["size"]): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/**
 * Wall Mount — flat horizontal bar form factor (low-profile wall unit).
 *
 * Visual: a flat, wide horizontal rectangle (landscape, 100×40-ish inside
 * the viewBox). Amber→rose gradient to visually distinguish from Wallbox.
 * A narrow horizontal LED strip and a small socket at the right end.
 */
export function WallMountIcon(
  {
    size = "md",
    class: classProp,
    className,
    haloColor = "oklch(0.78 0.12 195)",
  }: ChargerIconProps,
) {
  const px = resolveSize(size);
  const gradientId = "wallmount-gradient";
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={cn("inline-block", classProp, className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="oklch(0.80 0.18 75)" />
          <stop offset="100%" stop-color="oklch(0.70 0.22 10)" />
        </linearGradient>
      </defs>
      {/* Halo outer diffuse glow */}
      <rect
        x="4"
        y="36"
        width="92"
        height="28"
        rx="6"
        ry="6"
        fill="none"
        stroke={haloColor}
        stroke-width="1"
        opacity="0.4"
      />
      {/* Body — wide flat horizontal bar */}
      <rect
        x="6"
        y="38"
        width="88"
        height="24"
        rx="4"
        ry="4"
        fill={`url(#${gradientId})`}
      />
      {/* Halo ring — status-bearing LED, traced just inside the bar */}
      <rect
        x="9"
        y="41"
        width="82"
        height="18"
        rx="3"
        ry="3"
        fill="none"
        stroke={haloColor}
        stroke-width="2.5"
        opacity="0.95"
      />
      {/* LED strip */}
      <rect
        x="14"
        y="44"
        width="50"
        height="3"
        rx="1.5"
        ry="1.5"
        fill="white"
        opacity="0.85"
      />
      {/* Socket at right end */}
      <circle
        cx="80"
        cy="50"
        r="7"
        fill="none"
        stroke="white"
        stroke-width="2"
        opacity="0.95"
      />
      <rect x="77" y="48" width="1.8" height="4" rx="0.6" fill="white" />
      <rect x="81.2" y="48" width="1.8" height="4" rx="0.6" fill="white" />
      {/* Wall-mount bracket nubs */}
      <rect x="10" y="58" width="4" height="4" fill="rgba(0,0,0,0.3)" />
      <rect x="86" y="58" width="4" height="4" fill="rgba(0,0,0,0.3)" />
    </svg>
  );
}
