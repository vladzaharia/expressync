/**
 * MetricTile — canonical "icon-well + label + value [+ sublabel]" primitive.
 *
 * Used in detail-page overview rows (charging-session detail, sync detail,
 * invoice list stat strip, etc.). Keep tiles inside a grid; MetricTile itself
 * doesn't impose layout beyond its own flex row.
 */

import type { ComponentChildren } from "preact";
import type { LucideIcon } from "lucide-preact";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface MetricTileProps {
  icon: LucideIcon;
  label: string;
  value: ComponentChildren;
  sublabel?: string;
  accent?: AccentColor;
  size?: "sm" | "md";
  className?: string;
}

export function MetricTile({
  icon: Icon,
  label,
  value,
  sublabel,
  accent = "blue",
  size = "md",
  className,
}: MetricTileProps) {
  const wellSize = size === "sm" ? "size-9" : "size-10";
  const valueText = size === "sm" ? "text-base" : "text-lg";
  const tone = accentTailwindClasses[accent];

  return (
    <div class={cn("flex items-center gap-3", className)}>
      <div
        class={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          wellSize,
          tone.bg,
        )}
        aria-hidden="true"
      >
        <Icon class={cn("size-5", tone.text)} />
      </div>
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">{label}</p>
        <p
          class={cn(
            "font-semibold leading-tight tabular-nums",
            valueText,
          )}
        >
          {value}
        </p>
        {sublabel && <p class="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
    </div>
  );
}
