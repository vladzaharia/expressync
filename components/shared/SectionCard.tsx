/**
 * SectionCard — skinnier cousin of `PageCard` for sub-sections within a page.
 *
 * No BorderBeam, no GridPattern, no BlurFade. Just the standard Card shell
 * with an icon-optional title row, description, right-aligned actions slot,
 * and a content area. Use PageCard at the page root; use SectionCard inside.
 *
 * When `accent` is set, the header gets a subtle wash (`bg-{accent}-500/5`)
 * and the card border picks up the accent at low opacity. The body stays on
 * `bg-card` for text contrast — accent is a visual accent, not a takeover.
 */

import type { ComponentChildren } from "preact";
import type { LucideIcon } from "lucide-preact";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ComponentChildren;
  /**
   * Inherits the page's accent (typically the same value passed to
   * `PageCard.colorScheme`). Applies a header wash + tinted card border.
   */
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
  const iconClass = tone
    ? cn("size-5 mt-0.5 shrink-0", tone.iconWell.split(" ").slice(1).join(" "))
    : "size-5 text-muted-foreground mt-0.5 shrink-0";

  return (
    <Card
      class={cn(
        "rounded-lg border",
        tone && "border-[color:var(--border)]",
        className,
      )}
    >
      <CardHeader
        class={cn(
          "border-b pb-4",
          tone ? tone.headerWash : "border-border/50",
          headerClassName,
        )}
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3 flex-1 min-w-0">
            {Icon && <Icon class={iconClass} aria-hidden="true" />}
            <div class="min-w-0">
              <CardTitle class="text-base">{title}</CardTitle>
              {description && (
                <CardDescription class="text-xs">
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
          {actions && <div class="flex gap-2 shrink-0">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent class={cn("pt-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
