/**
 * EmptyState — canonical illustrated "nothing here yet" placeholder.
 *
 * Replaces per-feature `*EmptyState` components that all converged on the
 * same pattern: rounded bordered card + faint radial GridPattern + icon +
 * title + description + up to two CTAs.
 *
 * Actions render via the shadcn Button primitive so we inherit focus rings
 * and variant styling. Use `primaryAction.external: true` to open in a new
 * tab (adds rel=noopener + external-link icon). Use `icon` on the action
 * for a leading lucide glyph.
 */

import type { ComponentChildren } from "preact";
import type { LucideIcon } from "lucide-preact";
import { ExternalLink } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  ariaLabel?: string;
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  illustration?: ComponentChildren;
  title: string;
  description: ComponentChildren;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  accent?: AccentColor;
  size?: "md" | "lg";
  showGridPattern?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  accent = "blue",
  size = "md",
  showGridPattern = true,
  className,
}: EmptyStateProps) {
  const tone = accentTailwindClasses[accent];
  const padding = size === "lg" ? "p-16" : "p-12";
  const iconSize = size === "lg" ? "size-14" : "size-12";
  const titleSize = size === "lg" ? "text-xl" : "text-base";

  return (
    <div
      class={cn(
        "relative overflow-hidden rounded-xl border bg-card text-center",
        padding,
        className,
      )}
    >
      {showGridPattern && (
        <GridPattern
          class={cn(
            "absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(300px_circle_at_center,white,transparent)]",
            tone.text,
          )}
        />
      )}

      {illustration
        ? <div class="mx-auto mb-4">{illustration}</div>
        : Icon
        ? (
          <Icon
            class={cn("mx-auto", iconSize, tone.text)}
            aria-hidden="true"
          />
        )
        : null}

      <p class={cn("mt-4 font-medium", titleSize)}>{title}</p>
      <p class="mt-1 text-sm text-muted-foreground">{description}</p>

      {(primaryAction || secondaryAction) && (
        <div class="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {primaryAction && (
            <ActionButton action={primaryAction} variant="default" />
          )}
          {secondaryAction && (
            <ActionButton action={secondaryAction} variant="outline" />
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton(
  { action, variant }: {
    action: EmptyStateAction;
    variant: "default" | "outline";
  },
) {
  const ActionIcon = action.icon;
  const content = (
    <>
      {action.external && <ExternalLink class="size-4" aria-hidden="true" />}
      {!action.external && ActionIcon && (
        <ActionIcon class="size-4" aria-hidden="true" />
      )}
      <span>{action.label}</span>
    </>
  );

  if (action.href) {
    return (
      <Button asChild variant={variant}>
        <a
          href={action.href}
          target={action.external ? "_blank" : undefined}
          rel={action.external ? "noopener noreferrer" : undefined}
          aria-label={action.ariaLabel ?? action.label}
        >
          {content}
        </a>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      onClick={action.onClick}
      aria-label={action.ariaLabel ?? action.label}
    >
      {content}
    </Button>
  );
}
