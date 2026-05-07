import { cn } from "@/src/lib/utils/cn.ts";
import type { ChargerIconProps } from "./WallboxIcon.tsx";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: ChargerIconProps["size"]): number {
  if (typeof size === "number") return size;
  return SIZE_MAP[size ?? "md"];
}

/**
 * Tesla Wall Connector — tall narrow rounded rectangle echoing the Gen 3
 * faceplate proportions (~155mm wide × 345mm tall, ~9:20). Status is
 * carried by the vertical LED light strip down the centre of the
 * recessed front panel — the same affordance the real device uses.
 *
 * Geometry is a 1:1 port of the SwiftUI `drawTesla(into:)` path in
 * `ExpresScan/App/Features/Chargers/ChargerFormFactorIcon.swift` so
 * the iOS list and the web admin show the same silhouette.
 */
export function TeslaIcon(
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
      {/* Outer body — tall rounded rectangle */}
      <rect
        x="32"
        y="6"
        width="36"
        height="88"
        rx="14"
        ry="14"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Subtle highlight stroke for dimension */}
      <rect
        x="33"
        y="7"
        width="34"
        height="86"
        rx="13"
        ry="13"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Recessed tempered-glass faceplate */}
      <rect
        x="37"
        y="12"
        width="26"
        height="76"
        rx="9"
        ry="9"
        fill="oklch(0.18 0.01 250)"
      />
      {/* Vertical LED light strip — outer diffuse bleed */}
      <rect
        x="45.5"
        y="21"
        width="9"
        height="58"
        rx="4.5"
        ry="4.5"
        fill={haloColor}
        opacity="0.4"
      />
      {/* LED strip — the status-bearing element */}
      <rect
        x="47"
        y="23"
        width="6"
        height="54"
        rx="3"
        ry="3"
        fill={haloColor}
        opacity="0.95"
      />
    </svg>
  );
}
