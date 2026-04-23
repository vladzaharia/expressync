/**
 * QuickActionButton — large iconed action button used in the customer
 * dashboard QuickActionsRow.
 *
 * Touch target ≥ 88×88 px on mobile so it satisfies the iOS HIG
 * accessibility minimum without crowding adjacent buttons. Uses the shared
 * `Button` primitive's `mobile` size internally to inherit hit-area sizing
 * on small screens.
 */

import type { LucideIcon } from "lucide-preact";
import { Lock } from "lucide-preact";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";

export interface QuickActionButtonProps {
  icon: LucideIcon;
  label: string;
  subtext?: string;
  href?: string;
  onClick?: () => void;
  /** Disables the button and shows a `disabledReason` tooltip when set. */
  disabled?: boolean;
  /** Tooltip copy shown on hover/focus when `disabled`. */
  disabledReason?: string;
  accent?: AccentColor;
  className?: string;
}

export function QuickActionButton({
  icon: Icon,
  label,
  subtext,
  href,
  onClick,
  disabled = false,
  disabledReason,
  accent = "blue",
  className,
}: QuickActionButtonProps) {
  const tone = accentTailwindClasses[accent];

  const inner = (
    <span
      class={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-4",
        "min-h-[88px] min-w-[88px] text-center",
        "transition-all hover:bg-accent/40 active:scale-[0.97]",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <span
        class={cn(
          "flex size-10 items-center justify-center rounded-lg",
          tone.bg,
        )}
      >
        {disabled
          ? <Lock class={cn("size-5", tone.text)} aria-hidden="true" />
          : <Icon class={cn("size-5", tone.text)} aria-hidden="true" />}
      </span>
      <span class="text-sm font-semibold leading-tight">{label}</span>
      {subtext && (
        <span class="text-[11px] text-muted-foreground leading-tight">
          {subtext}
        </span>
      )}
    </span>
  );

  const node = href && !disabled
    ? (
      <a
        href={href}
        aria-label={label}
        class="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        {inner}
      </a>
    )
    : (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-label={label}
        aria-disabled={disabled}
        disabled={disabled}
        class="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        {inner}
      </button>
    );

  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span class="block">{node}</span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    );
  }

  return node;
}
