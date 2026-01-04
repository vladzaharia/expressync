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
        "bg-clip-text text-transparent animate-aurora",
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
