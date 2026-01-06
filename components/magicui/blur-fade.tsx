import type { ComponentChildren } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";

interface BlurFadeProps {
  children: ComponentChildren;
  className?: string;
  /** Animation duration in seconds */
  duration?: number;
  /** Animation delay in seconds */
  delay?: number;
  /** Offset distance in pixels */
  offset?: number;
  /** Direction of the fade animation */
  direction?: "up" | "down" | "left" | "right";
  /** Blur amount in pixels */
  blur?: number;
}

/**
 * BlurFade Component
 *
 * A CSS-based blur fade animation component for Preact.
 * Animates content with a blur and fade effect on mount.
 */
export function BlurFade({
  children,
  className,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = "down",
  blur = 6,
}: BlurFadeProps) {
  // Calculate transform based on direction
  const getTransform = () => {
    switch (direction) {
      case "up":
        return `translateY(${offset}px)`;
      case "down":
        return `translateY(-${offset}px)`;
      case "left":
        return `translateX(${offset}px)`;
      case "right":
        return `translateX(-${offset}px)`;
    }
  };

  return (
    <div
      className={cn("animate-blur-fade", className)}
      style={{
        "--blur-fade-duration": `${duration}s`,
        "--blur-fade-delay": `${delay}s`,
        "--blur-fade-blur": `${blur}px`,
        "--blur-fade-transform": getTransform(),
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * BlurFadeStagger Component
 *
 * Wraps multiple children with staggered blur fade animations.
 */
interface BlurFadeStaggerProps {
  children: ComponentChildren[];
  className?: string;
  /** Base delay before first item */
  baseDelay?: number;
  /** Delay between each item */
  staggerDelay?: number;
  /** Animation duration for each item */
  duration?: number;
  /** Direction of the fade animation */
  direction?: "up" | "down" | "left" | "right";
}

export function BlurFadeStagger({
  children,
  className,
  baseDelay = 0,
  staggerDelay = 0.1,
  duration = 0.4,
  direction = "up",
}: BlurFadeStaggerProps) {
  return (
    <div className={className}>
      {Array.isArray(children) &&
        children.map((child, index) => (
          <BlurFade
            key={index}
            delay={baseDelay + index * staggerDelay}
            duration={duration}
            direction={direction}
          >
            {child}
          </BlurFade>
        ))}
    </div>
  );
}
