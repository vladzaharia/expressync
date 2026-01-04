import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren, JSX } from "preact";

interface LineShadowTextProps {
  children: ComponentChildren;
  shadowColor?: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

export function LineShadowText({
  children,
  shadowColor = "currentColor",
  className,
  as: Component = "span",
}: LineShadowTextProps) {
  const content = typeof children === "string" ? children : null;

  if (!content) {
    throw new Error("LineShadowText only accepts string content");
  }

  return (
    <Component
      style={{ "--shadow-color": shadowColor } as JSX.CSSProperties}
      className={cn(
        "relative z-0 inline-flex",
        "after:absolute after:top-[0.04em] after:left-[0.04em] after:content-[attr(data-text)]",
        "after:bg-[linear-gradient(45deg,transparent_45%,var(--shadow-color)_45%,var(--shadow-color)_55%,transparent_0)]",
        "after:-z-10 after:bg-[length:0.06em_0.06em] after:bg-clip-text after:text-transparent",
        "after:animate-line-shadow",
        className,
      )}
      data-text={content}
    >
      {content}
    </Component>
  );
}

