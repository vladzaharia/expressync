/**
 * CommandItem — single row inside the ⌘K palette (Phase P6).
 *
 * Renders an icon (tinted by destination accent), title, optional subtitle,
 * and optional shortcut chip. cmdk drives selection + keyboard nav; this
 * component is a presentational wrapper around `Command.Item` plus ARIA
 * affordances required by the plan.
 */

import { Command } from "cmdk";
import type { ComponentChildren } from "preact";
import type { LucideIcon } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  ACCENT_TEXT,
  type CommandAccent,
} from "@/src/lib/command-palette/commands.ts";

interface CommandItemProps {
  /** Stable id; used for cmdk's `value` prop. */
  value: string;
  /** Extra keywords fed to cmdk's fuzzy matcher. */
  keywords?: string[];
  icon?: LucideIcon;
  accent?: CommandAccent;
  title: string;
  subtitle?: string;
  /** Rendered right-aligned; typically a <kbd> shortcut chip. */
  trailing?: ComponentChildren;
  onSelect: () => void;
}

export function CommandItem({
  value,
  keywords,
  icon: Icon,
  accent = "neutral",
  title,
  subtitle,
  trailing,
  onSelect,
}: CommandItemProps) {
  const iconColor = ACCENT_TEXT[accent] ?? ACCENT_TEXT.neutral;

  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm",
        "text-foreground/90",
        "data-[selected=true]:bg-muted data-[selected=true]:text-foreground",
        "aria-selected:bg-muted",
      )}
    >
      {Icon
        ? <Icon className={cn("size-4 shrink-0", iconColor)} />
        : <span className="size-4 shrink-0" aria-hidden="true" />}
      <span className="flex flex-col min-w-0 flex-1">
        <span className="truncate">{title}</span>
        {subtitle && (
          <span className="text-xs text-muted-foreground truncate">
            {subtitle}
          </span>
        )}
      </span>
      {trailing && (
        <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
          {trailing}
        </span>
      )}
    </Command.Item>
  );
}
