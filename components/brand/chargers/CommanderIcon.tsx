import { cn } from "@/src/lib/utils/cn.ts";
import type { ChargerIconProps } from "./WallboxIcon.tsx";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: ChargerIconProps["size"]): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/**
 * Commander — pedestal/bollard form factor.
 *
 * Visual: a tall pedestal shape — wider rectangular base (8px corners) with
 * a narrower upper column and a dome-rounded top cap housing a screen. Fill
 * uses the same blue→purple palette as Wallbox but a touch cooler. Uses a
 * narrower 40×100 effective footprint inside the 100×100 viewBox.
 */
export function CommanderIcon(
  {
    size = "md",
    class: classProp,
    className,
    haloColor = "oklch(0.78 0.12 195)",
  }: ChargerIconProps,
) {
  const px = resolveSize(size);
  const gradientId = "commander-gradient";
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
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="oklch(0.70 0.18 230)" />
          <stop offset="100%" stop-color="oklch(0.60 0.25 275)" />
        </linearGradient>
      </defs>
      {/* Halo outer diffuse glow — outlines the silhouette */}
      <path
        d="M 22 80 L 22 94 L 78 94 L 78 80 L 68 80 L 68 22 Q 68 8 58 8 L 42 8 Q 32 8 32 22 L 32 80 Z"
        fill="none"
        stroke={haloColor}
        stroke-width="2"
        opacity="0.4"
      />
      {/* Base plinth — wider, slight bevel */}
      <rect
        x="24"
        y="82"
        width="52"
        height="10"
        rx="2"
        ry="2"
        fill={`url(#${gradientId})`}
      />
      {/* Halo ring — status-bearing LED, traced inside the silhouette */}
      <path
        d="M 26 80 L 26 90 L 74 90 L 74 80 L 65 80 L 65 22 Q 65 11 41 11 L 59 11 Q 35 11 35 22 L 35 80 Z"
        fill="none"
        stroke={haloColor}
        stroke-width="5"
        opacity="0.95"
      />
      {/* Main column — tall pedestal body */}
      <path
        d="M 34 22 Q 34 10 42 10 L 58 10 Q 66 10 66 22 L 66 82 L 34 82 Z"
        fill={`url(#${gradientId})`}
      />
      {/* Screen */}
      <rect
        x="40"
        y="24"
        width="20"
        height="28"
        rx="2"
        ry="2"
        fill="rgba(0,0,0,0.35)"
      />
      {/* Screen glow */}
      <rect
        x="42"
        y="26"
        width="16"
        height="4"
        rx="1"
        ry="1"
        fill="oklch(0.85 0.22 145)"
        opacity="0.6"
      />
      {/* Cable port */}
      <circle cx="50" cy="66" r="4" fill="rgba(0,0,0,0.4)" />
      <circle cx="50" cy="66" r="1.5" fill="white" opacity="0.8" />
    </svg>
  );
}
