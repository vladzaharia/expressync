import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren } from "preact";

interface ShineBorderProps {
  borderRadius?: number;
  borderWidth?: number;
  duration?: number;
  color?: string | string[];
  className?: string;
  children: ComponentChildren;
}

export function ShineBorder({
  borderRadius = 8,
  borderWidth = 1,
  duration = 14,
  color = [
    "oklch(0.75 0.15 200)",
    "oklch(0.75 0.22 145)",
    "oklch(0.70 0.22 280)",
  ],
  className,
  children,
}: ShineBorderProps) {
  const colorString = Array.isArray(color) ? color.join(", ") : color;

  return (
    <div
      style={{
        "--border-radius": `${borderRadius}px`,
        "--border-width": `${borderWidth}px`,
        "--shine-pulse-duration": `${duration}s`,
        "--shine-colors": colorString,
        background:
          `linear-gradient(var(--background), var(--background)) padding-box, linear-gradient(90deg, ${colorString}, ${colorString}) border-box`,
        backgroundSize: "200% 200%",
      }}
      className={cn(
        "relative rounded-[var(--border-radius)] border-[length:var(--border-width)] border-transparent animate-shine",
        className,
      )}
    >
      {children}
    </div>
  );
}
