import { cn } from "@/src/lib/utils/cn.ts";
import type { ChargerIconProps } from "./WallboxIcon.tsx";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: ChargerIconProps["size"]): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/**
 * Pulsar — Wallbox Pulsar-style vertical slab.
 *
 * Visual: a tall vertical rectangle (portrait orientation) with sharper 3px
 * corners, filled with a green→teal gradient. A rounded "pulse ring"
 * centered on the face hints at the LED ring. 100×100 viewBox.
 */
export function PulsarIcon(
  {
    size = "md",
    class: classProp,
    className,
    haloColor = "oklch(0.78 0.12 195)",
  }: ChargerIconProps,
) {
  const px = resolveSize(size);
  const gradientId = "pulsar-gradient";
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
          <stop offset="0%" stop-color="oklch(0.75 0.22 145)" />
          <stop offset="100%" stop-color="oklch(0.70 0.18 190)" />
        </linearGradient>
      </defs>
      {/* Halo outer diffuse glow */}
      <rect
        x="28"
        y="6"
        width="44"
        height="88"
        rx="5"
        ry="5"
        fill="none"
        stroke={haloColor}
        stroke-width="1"
        opacity="0.4"
      />
      {/* Body — vertical slab, sharp corners */}
      <rect
        x="30"
        y="8"
        width="40"
        height="84"
        rx="3"
        ry="3"
        fill={`url(#${gradientId})`}
      />
      {/* Halo ring — status-bearing LED, traced just inside the body */}
      <rect
        x="33"
        y="11"
        width="34"
        height="78"
        rx="2"
        ry="2"
        fill="none"
        stroke={haloColor}
        stroke-width="2.5"
        opacity="0.95"
      />
      {/* Face recess */}
      <rect
        x="34"
        y="14"
        width="32"
        height="72"
        rx="2"
        ry="2"
        fill="rgba(0,0,0,0.15)"
      />
      {/* LED pulse ring (outer) */}
      <circle
        cx="50"
        cy="50"
        r="14"
        fill="none"
        stroke="white"
        stroke-width="2.5"
        opacity="0.9"
      />
      {/* LED pulse ring (inner) */}
      <circle
        cx="50"
        cy="50"
        r="6"
        fill="white"
        opacity="0.8"
      />
    </svg>
  );
}
