/**
 * SectionCard — skinnier cousin of `PageCard` for sub-sections within a page.
 *
 * Self-contained flex layout — deliberately bypasses shadcn `CardHeader`'s
 * CSS grid (which expects `data-slot` children like `CardAction`, and breaks
 * when we nest our own icon + description + actions flex inside it). The
 * header is one flex row: icon · (title / description) · actions, all
 * vertically aligned to the title baseline so descriptions wrapping to a
 * second line don't shove the icon or actions around.
 *
 * When `accent` is set the header gets a subtle wash (`bg-{accent}-500/5`);
 * the body stays on `bg-card` for text contrast.
 */

import type { ComponentChildren } from "preact";
import type { LucideIcon } from "lucide-preact";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ComponentChildren;
  /** Inherits the page's accent — applies a header wash + tinted border. */
  accent?: AccentColor;
  children: ComponentChildren;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  accent,
  children,
  className,
  headerClassName,
  contentClassName,
}: SectionCardProps) {
  const tone = accent ? stripToneClasses[accent] : undefined;
  // Icon-well gets the accent icon colour if accent is set; otherwise neutral.
  const iconWellClass = tone ? tone.iconWell : "bg-muted text-muted-foreground";

  return (
    <div
      class={cn(
        "flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden",
        className,
      )}
    >
      <header
        class={cn(
          "flex items-center gap-3 border-b px-5 py-3",
          tone ? tone.headerWash : "border-border/50",
          headerClassName,
        )}
      >
        {Icon && (
          <span
            class={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md",
              iconWellClass,
            )}
            aria-hidden="true"
          >
            <Icon class="size-4" />
          </span>
        )}
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold leading-tight truncate">{title}</h3>
          {description && (
            <p class="mt-0.5 text-xs text-muted-foreground truncate">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div class="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>
      <div class={cn("p-5", contentClassName)}>{children}</div>
    </div>
  );
}
