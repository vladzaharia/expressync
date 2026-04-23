import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren } from "preact";

interface AuroraTextProps {
  children: ComponentChildren;
  className?: string;
  colors?: string[];
  speed?: number;
}

export function AuroraText({
  children,
  className,
  colors = [
    "oklch(0.75 0.15 200)", // Electric cyan
    "oklch(0.75 0.22 145)", // Volt green
    "oklch(0.70 0.22 280)", // Violet
    "oklch(0.75 0.15 200)", // Back to cyan
  ],
  speed = 8,
}: AuroraTextProps) {
  const gradientColors = colors.join(", ");

  return (
    <span
      className={cn(
        // Polaris Track H: gate animation on prefers-reduced-motion. The
        // gradient stays painted; only the slow color shimmer is dropped.
        "bg-clip-text text-transparent motion-safe:animate-aurora",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(90deg, ${gradientColors})`,
        "--aurora-speed": `${speed}s`,
      }}
    >
      {children}
    </span>
  );
}
