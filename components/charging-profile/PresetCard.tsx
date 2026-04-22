/**
 * Phase P5 — PresetCard
 *
 * A single selectable preset "radio card" shown in the profile editor's
 * preset grid. Emerald accent when selected; disabled state for stubs
 * (solar) with an inline tooltip-style hint.
 */

import type { ComponentChildren } from "preact";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { Check, Lock } from "lucide-preact";

export interface PresetCardProps {
  id: string;
  title: string;
  description: string;
  icon: ComponentChildren;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}

export function PresetCard({
  id,
  title,
  description,
  icon,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: PresetCardProps) {
  const ariaDisabled = disabled ? "true" : undefined;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={ariaDisabled}
      aria-label={title}
      data-preset={id}
      disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      className={cn(
        "text-left rounded-lg border-2 p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
        selected
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-border hover:border-emerald-500/60",
        disabled && "opacity-60 cursor-not-allowed hover:border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex items-center justify-center size-10 rounded-md shrink-0",
            selected
              ? "bg-emerald-500 text-white"
              : "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">{title}</h4>
            {selected && !disabled && (
              <Check
                className="size-4 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            )}
            {disabled && (
              <Badge variant="outline" className="text-xs">
                <Lock className="size-3" aria-hidden="true" />
                Soon
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              {disabledReason}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
