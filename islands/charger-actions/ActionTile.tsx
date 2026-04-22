/**
 * ActionTile — card tile for a single remote action. Shows icon + label +
 * short description. When disabled, rendered dimmed and wrapped in a
 * tooltip-style `title` attribute exposing the reason.
 *
 * Kept intentionally small (not an island — plain component consumed by
 * `RemoteActionsPanel`) so hover states and keyboard focus match the rest
 * of the card-style tiles across the app.
 */

import type { LucideIcon } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

export interface ActionTileProps {
  icon: LucideIcon;
  label: string;
  description: string;
  accent?: "default" | "destructive";
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

export function ActionTile(
  {
    icon: Icon,
    label,
    description,
    accent = "default",
    disabled = false,
    disabledReason,
    onClick,
  }: ActionTileProps,
) {
  const isDestructive = accent === "destructive";
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled}
      class={cn(
        "group flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left transition-colors",
        "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed opacity-50 hover:bg-card",
        !disabled && isDestructive &&
          "hover:border-rose-500/40 hover:bg-rose-500/5",
      )}
    >
      <div class="flex items-center gap-2">
        <Icon
          class={cn(
            "size-4",
            isDestructive
              ? "text-rose-600 dark:text-rose-400"
              : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span class="text-sm font-medium">{label}</span>
      </div>
      <span class="text-xs text-muted-foreground line-clamp-2">
        {description}
      </span>
      {disabled && disabledReason && (
        <span class="text-[11px] italic text-muted-foreground/80">
          {disabledReason}
        </span>
      )}
    </button>
  );
}

export default ActionTile;
