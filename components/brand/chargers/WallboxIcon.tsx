import { cn } from "@/src/lib/utils/cn.ts";

export interface ChargerIconProps {
  size?: "sm" | "md" | "lg" | number;
  class?: string;
  className?: string;
  /**
   * Color for the halo ring. When used as a status indicator:
   *   - red  → offline / faulted
   *   - amber → locked / reserved / unavailable
   *   - azure → available (unlocked, not charging)
   *   - green → actively charging
   * Callers pass a themed color string (oklch / hex / Tailwind rgb var). When
   * omitted the halo falls back to the Pulsar Plus default teal.
   */
  haloColor?: string;
}

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: ChargerIconProps["size"]): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/**
 * Wallbox Pulsar Plus — used as the charger card's primary status indicator.
 *
 * Reference: matte dark body, rounded square silhouette (~22% corner radius),
 * and a distinctive inset LED halo running around the face. The halo is the
 * status-bearing element; the body itself stays neutral dark grey so the
 * colored ring reads clearly against it.
 */
export function WallboxIcon(
  {
    size = "md",
    class: classProp,
    className,
    haloColor = "oklch(0.78 0.12 195)",
  }: ChargerIconProps,
) {
  const px = resolveSize(size);
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={cn("inline-block", classProp, className)}
    >
      {/* Body — rounded square, fixed dark grey so the halo color is always legible */}
      <rect
        x="8"
        y="8"
        width="84"
        height="84"
        rx="19"
        ry="19"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Subtle highlight edge for a bit of dimension */}
      <rect
        x="9"
        y="9"
        width="82"
        height="82"
        rx="18"
        ry="18"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — the status-bearing LED */}
      <rect
        x="19"
        y="19"
        width="62"
        height="62"
        rx="13"
        ry="13"
        fill="none"
        stroke={haloColor}
        stroke-width="2.5"
        opacity="0.95"
      />
      {/* Halo outer diffuse glow (LED bleed) */}
      <rect
        x="18"
        y="18"
        width="64"
        height="64"
        rx="14"
        ry="14"
        fill="none"
        stroke={haloColor}
        stroke-width="1"
        opacity="0.4"
      />
      {/* Central face — darker recessed panel */}
      <rect
        x="24"
        y="24"
        width="52"
        height="52"
        rx="10"
        ry="10"
        fill="oklch(0.18 0.01 250)"
      />
    </svg>
  );
}
