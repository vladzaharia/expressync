import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren, JSX } from "preact";

interface PulsatingButtonProps
  extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "className"> {
  children: ComponentChildren;
  className?: string;
  pulseColor?: string;
  duration?: string;
}

export function PulsatingButton({
  children,
  className,
  pulseColor = "oklch(0.75 0.15 200)",
  duration = "1.5s",
  ...props
}: PulsatingButtonProps) {
  return (
    <button
      className={cn(
        "relative flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-center text-primary-foreground",
        className,
      )}
      style={{
        "--pulse-color": pulseColor,
        "--duration": duration,
      }}
      {...props}
    >
      <div className="relative z-10">{children}</div>
      <div className="absolute left-1/2 top-1/2 size-full -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-lg bg-inherit" />
    </button>
  );
}
