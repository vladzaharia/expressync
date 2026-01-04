import { cn } from "@/src/lib/utils/cn.ts";

interface LightRaysProps {
  className?: string;
  /** Number of rays to render */
  rayCount?: number;
  /** Base color for rays (CSS color) */
  color?: string;
  /** Animation duration in seconds */
  duration?: number;
  /** Whether to animate the rays */
  animated?: boolean;
}

/**
 * Light Rays Background Component
 *
 * Creates an animated light rays effect emanating from the top of the container.
 * Inspired by MagicUI's background effects.
 */
export function LightRays({
  className,
  rayCount = 8,
  color = "hsl(var(--primary))",
  duration = 8,
  animated = true,
}: LightRaysProps) {
  const rays = Array.from({ length: rayCount }, (_, i) => {
    const angle = (i / rayCount) * 180 - 90; // Spread from -90 to 90 degrees
    const delay = (i / rayCount) * duration;
    const width = 2 + Math.random() * 3; // Random width between 2-5
    const opacity = 0.1 + Math.random() * 0.15; // Random opacity between 0.1-0.25

    return {
      angle,
      delay,
      width,
      opacity,
    };
  });

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {/* Gradient overlay for smooth fade */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

      {/* Light source glow */}
      <div
        className="absolute -top-20 left-1/2 -translate-x-1/2 size-40 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          opacity: 0.3,
        }}
      />

      {/* Rays */}
      {rays.map((ray, i) => (
        <div
          key={i}
          className={cn(
            "absolute top-0 left-1/2 origin-top",
            animated && "animate-pulse",
          )}
          style={{
            width: `${ray.width}px`,
            height: "100%",
            background: `linear-gradient(to bottom, ${color} 0%, transparent 80%)`,
            opacity: ray.opacity,
            transform: `translateX(-50%) rotate(${ray.angle}deg)`,
            animationDelay: `${ray.delay}s`,
            animationDuration: `${duration}s`,
          }}
        />
      ))}

      {/* Additional ambient glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${color} 0%, transparent 60%)`,
          opacity: 0.1,
        }}
      />
    </div>
  );
}

/**
 * Subtle Light Rays variant for page backgrounds
 */
export function SubtleLightRays({ className }: { className?: string }) {
  return (
    <LightRays
      className={cn("opacity-30 dark:opacity-20", className)}
      rayCount={6}
      duration={12}
    />
  );
}

