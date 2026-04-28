import { cn } from "@/src/lib/utils/cn.ts";
import { AuroraText } from "../magicui/aurora-text.tsx";
import { Particles } from "../magicui/particles.tsx";
import { BorderBeam } from "../magicui/border-beam.tsx";
import { ExpresSyncLogo } from "./ExpresSyncBrand.tsx";

/**
 * Polaris Track A — customer-surface brand component.
 *
 * Sibling to `ExpresSyncBrand.tsx`; mirrors its API surface so the layout
 * components can swap brands by `role`. The icon is an inline 8-point
 * compass star (the "Polaris" north star) on the existing squircle gradient,
 * and the wordmark reads "Polaris Express" via the same AuroraText effect.
 *
 * Variants:
 *   - logo-only / sidebar-collapsed — square glyph
 *   - sidebar-expanded               — glyph + small wordmark (gap-3)
 *   - login                          — large glyph + large wordmark
 *   - header-mobile                  — small glyph + small wordmark
 *                                      (gap-2) for the customer mobile
 *                                      shell top bar
 */
type BrandVariant =
  | "logo-only"
  | "sidebar-collapsed"
  | "sidebar-expanded"
  | "login"
  | "header-mobile";

interface PolarisExpressBrandProps {
  variant?: BrandVariant;
  className?: string;
  showBorderBeam?: boolean;
  showParticles?: boolean;
}

// Polaris brand gradient — leans on the same OKLch palette as ExpresSync so
// the squircle stays visually consistent across surfaces. The Polaris green
// (#0E7C66) is reserved for email + manifest theme_color per the plan; UI
// chrome continues to use the canonical primary/accent tokens.
const brandColors = [
  "oklch(0.75 0.15 200)", // Electric cyan
  "oklch(0.75 0.22 145)", // Volt green
  "oklch(0.70 0.20 180)", // Teal
  "oklch(0.75 0.15 200)", // Back to cyan
];

/**
 * 8-point compass star ("Polaris" north star), rendered as a self-contained
 * inline SVG so it inherits its color from `currentColor` and scales with
 * the parent box. Four long primary spokes (N/E/S/W) interleave with four
 * shorter diagonal spokes (NE/SE/SW/NW); a small inner dot anchors the
 * center for legibility at 16px.
 */
function PolarisStar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      className={className}
    >
      {/* Primary cardinal spokes (N/E/S/W) — long, thin diamonds. */}
      <polygon points="12,1 13.2,12 12,23 10.8,12" />
      <polygon points="23,12 12,13.2 1,12 12,10.8" />
      {/* Diagonal spokes (NE/SE/SW/NW) — shorter, slightly thinner; rotated 45deg. */}
      <g transform="rotate(45 12 12)">
        <polygon points="12,4 12.7,12 12,20 11.3,12" opacity="0.85" />
        <polygon points="20,12 12,12.7 4,12 12,11.3" opacity="0.85" />
      </g>
      {/* Center dot — adds presence at small sizes. */}
      <circle cx="12" cy="12" r="1.4" />
    </svg>
  );
}

// Logo component — squircle with Polaris star (mirrors ExpresSyncLogo).
function PolarisExpressLogo({
  size = "md",
  showParticles = false,
  className,
}: {
  size?: "sm" | "md" | "lg";
  showParticles?: boolean;
  className?: string;
}) {
  const sizeClasses = {
    sm: "size-8",
    md: "size-10",
    lg: "size-14",
  };
  const iconSizes = {
    sm: "size-4",
    md: "size-5",
    lg: "size-7",
  };

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Squircle container with gradient background */}
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden",
          "rounded-[30%] bg-gradient-to-br from-primary via-accent to-primary",
          "shadow-lg animate-gradient",
          sizeClasses[size],
        )}
        style={{
          backgroundSize: "200% 200%",
        }}
      >
        {/* Particles inside logo */}
        {showParticles && (
          <Particles
            className="absolute inset-0"
            quantity={8}
            size={1.2}
            color="rgba(255,255,255,0.8)"
            staticity={50}
            ease={80}
          />
        )}

        {/* Polaris star icon */}
        <PolarisStar
          className={cn(
            iconSizes[size],
            "text-primary-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]",
          )}
        />

        {/* Border beam effect */}
        <BorderBeam
          size={40}
          duration={2}
          colorFrom="rgba(255,255,255,0.8)"
          colorTo="rgba(255,255,255,0.2)"
          className="opacity-80"
        />
        <BorderBeam
          size={40}
          duration={2}
          delay={1}
          colorFrom="rgba(255,255,255,0.2)"
          colorTo="rgba(255,255,255,0.8)"
          className="opacity-60"
          reverse
        />
      </div>

      {/* Outer glow */}
      <div className="absolute inset-0 rounded-[30%] bg-gradient-to-r from-primary via-accent to-primary opacity-40 blur-md animate-pulse" />
    </div>
  );
}

// Wordmark component — "Polaris Express" via AuroraText.
function PolarisExpressWordmark({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-3xl",
  };

  return (
    <span className={cn("font-bold whitespace-nowrap", sizeClasses[size])}>
      <AuroraText colors={brandColors} speed={6}>
        ExpressCharge
      </AuroraText>
    </span>
  );
}

// Main component with variants
export function PolarisExpressBrand({
  variant = "sidebar-expanded",
  className,
  showParticles = false,
}: PolarisExpressBrandProps) {
  switch (variant) {
    case "logo-only":
    case "sidebar-collapsed":
      return (
        <ExpresSyncLogo
          size="sm"
          showParticles={showParticles}
          className={className}
        />
      );

    case "sidebar-expanded":
      return (
        <div className={cn("flex items-center gap-3", className)}>
          <ExpresSyncLogo size="sm" showParticles={showParticles} />
          <PolarisExpressWordmark size="sm" />
        </div>
      );

    case "header-mobile":
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <ExpresSyncLogo size="sm" showParticles={showParticles} />
          <PolarisExpressWordmark size="sm" />
        </div>
      );

    case "login":
      return (
        <div className={cn("flex items-center gap-3", className)}>
          <ExpresSyncLogo size="lg" showParticles={showParticles} />
          <PolarisExpressWordmark size="lg" />
        </div>
      );

    default:
      return null;
  }
}

export { PolarisExpressLogo, PolarisExpressWordmark, PolarisStar };
