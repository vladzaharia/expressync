import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren } from "preact";

interface BorderBeamProps {
  className?: string;
  size?: number;
  duration?: number;
  borderWidth?: number;
  anchor?: number;
  colorFrom?: string;
  colorTo?: string;
  delay?: number;
}

export function BorderBeam({
  className,
  size = 200,
  duration = 15,
  anchor = 90,
  borderWidth = 1.5,
  colorFrom = "var(--glow-cyan)",
  colorTo = "var(--glow-green)",
  delay = 0,
}: BorderBeamProps) {
  return (
    <div
      style={{
        "--size": `${size}px`,
        "--duration": `${duration}s`,
        "--anchor": `${anchor}%`,
        "--border-width": `${borderWidth}px`,
        "--color-from": colorFrom,
        "--color-to": colorTo,
        "--delay": `-${delay}s`,
      }}
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] [border:calc(var(--border-width))_solid_transparent]",
        // mask styles
        "![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]",
        // pseudo styles
        "after:absolute after:aspect-square after:w-[var(--size)] after:animate-border-beam after:[animation-delay:var(--delay)] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:calc(var(--anchor))_50%] after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)))]",
        className,
      )}
    />
  );
}

interface BorderBeamCardProps {
  children: ComponentChildren;
  className?: string;
  beamProps?: BorderBeamProps;
}

export function BorderBeamCard(
  { children, className, beamProps }: BorderBeamCardProps,
) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl", className)}>
      {children}
      <BorderBeam {...beamProps} />
    </div>
  );
}
