import { cn } from "@/src/lib/utils/cn.ts";
import type { ChargerIconProps } from "./WallboxIcon.tsx";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: ChargerIconProps["size"]): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/**
 * Generic — fallback form factor.
 *
 * Visual: a clean circle filled with a neutral slate gradient, containing a
 * lucide-style plug glyph (two prongs + body + short lead). Used whenever
 * form_factor doesn't match any recognized type.
 */
export function GenericChargerIcon(
  {
    size = "md",
    class: classProp,
    className,
    haloColor = "oklch(0.78 0.12 195)",
  }: ChargerIconProps,
) {
  const px = resolveSize(size);
  const gradientId = "generic-gradient";
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
          <stop offset="0%" stop-color="oklch(0.65 0.04 260)" />
          <stop offset="100%" stop-color="oklch(0.50 0.03 250)" />
        </linearGradient>
      </defs>
      {/* Halo outer diffuse glow */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke={haloColor}
        stroke-width="1"
        opacity="0.4"
      />
      {/* Base circle */}
      <circle cx="50" cy="50" r="40" fill={`url(#${gradientId})`} />
      {/* Halo ring — status-bearing LED, traced just inside the body */}
      <circle
        cx="50"
        cy="50"
        r="37"
        fill="none"
        stroke={haloColor}
        stroke-width="2.5"
        opacity="0.95"
      />
      {/* Plug body (lucide Plug-style) */}
      {/* Prongs */}
      <rect x="40" y="22" width="4" height="14" rx="1" fill="white" />
      <rect x="56" y="22" width="4" height="14" rx="1" fill="white" />
      {/* Plug housing */}
      <path
        d="M 34 38 L 66 38 L 66 52 Q 66 62 50 62 Q 34 62 34 52 Z"
        fill="white"
      />
      {/* Cord */}
      <rect x="47" y="62" width="6" height="18" rx="2" fill="white" />
      {/* Loop */}
      <path
        d="M 50 80 Q 50 86 56 86"
        fill="none"
        stroke="white"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
  );
}
