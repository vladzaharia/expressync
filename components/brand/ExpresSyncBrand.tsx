import { cn } from "@/src/lib/utils/cn.ts";
import { Zap } from "lucide-preact";
import { AuroraText } from "../magicui/aurora-text.tsx";
import { LineShadowText } from "../magicui/line-shadow-text.tsx";
import { Particles } from "../magicui/particles.tsx";
import { BorderBeam } from "../magicui/border-beam.tsx";

type BrandVariant = "logo-only" | "sidebar-collapsed" | "sidebar-expanded" | "login";

interface ExpresSyncBrandProps {
  variant?: BrandVariant;
  className?: string;
  showBorderBeam?: boolean;
  showParticles?: boolean;
}

// Electric theme colors - blue to green gradient
const expresColors = [
  "oklch(0.75 0.15 200)", // Electric cyan
  "oklch(0.75 0.22 145)", // Volt green
  "oklch(0.75 0.15 200)", // Back to cyan
];

// Reversed - green to blue gradient
const syncColors = [
  "oklch(0.75 0.22 145)", // Volt green
  "oklch(0.75 0.15 200)", // Electric cyan
  "oklch(0.75 0.22 145)", // Back to green
];

// Logo component - squircle with thunderbolt
function ExpresSyncLogo({
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

        {/* Thunderbolt icon */}
        <Zap
          className={cn(
            iconSizes[size],
            "text-primary-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]",
          )}
          fill="currentColor"
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

// Wordmark component
function ExpresSyncWordmark({
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
    <span className={cn("font-bold", sizeClasses[size])}>
      <AuroraText colors={expresColors} speed={5}>
        Expres
      </AuroraText>
      <AuroraText colors={syncColors} speed={7}>
        Sync
      </AuroraText>
    </span>
  );
}

// Main component with variants
export function ExpresSyncBrand({
  variant = "sidebar-expanded",
  className,
  showParticles = false,
}: ExpresSyncBrandProps) {
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
          <ExpresSyncWordmark size="sm" />
        </div>
      );

    case "login":
      return (
        <div className={cn("flex items-center gap-3", className)}>
          <ExpresSyncLogo size="lg" showParticles={showParticles} />
          <ExpresSyncWordmark size="lg" />
        </div>
      );

    default:
      return null;
  }
}

export { ExpresSyncLogo, ExpresSyncWordmark };

