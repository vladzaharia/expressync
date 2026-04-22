/**
 * SectionCard — skinnier cousin of `PageCard` for sub-sections within a page.
 *
 * No BorderBeam, no GridPattern, no BlurFade. Just the standard Card shell
 * with an icon-optional title row, description, right-aligned actions slot,
 * and a content area. Use PageCard at the page root; use SectionCard inside.
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
import { cn } from "@/src/lib/utils/cn.ts";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ComponentChildren;
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
  children,
  className,
  headerClassName,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card class={cn("rounded-lg border", className)}>
      <CardHeader
        class={cn("border-b border-border/50 pb-4", headerClassName)}
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3 flex-1 min-w-0">
            {Icon && (
              <Icon
                class="size-5 text-muted-foreground mt-0.5 shrink-0"
                aria-hidden="true"
              />
            )}
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
