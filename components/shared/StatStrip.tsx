/**
 * StatStrip — unified "top statistics" primitive for listing pages.
 *
 * Renders a responsive grid of cells (2 / 3 / N columns). Each cell is an
 * icon-well + value + uppercase label, optionally:
 *   - clickable (`href`) → filter shortcut
 *   - active (`active: true`) → 2px accent ring + `aria-current="true"`
 *   - warned (`warn: true`) → forces amber tone regardless of page accent
 *   - disabled-when-zero (`disabledWhenZero: true`) → `aria-disabled`, no focus
 *   - dashed border
 *
 * Every cell inherits the strip's `accent` unless the item sets its own
 * `tone`. Semantic tone overrides (`amber` warning, `rose` error,
 * `emerald` success, `muted` neutral) are the only sanctioned reasons to
 * diverge from the page's accent.
 *
 * Use for listing-page headers. For detail-page overview rows, use
 * `MetricTile` (flex row, no grid cell semantics).
 */

import type { ComponentChildren } from "preact";
import type { LucideIcon } from "lucide-preact";
import {
  type AccentColor,
  type StripTone,
  stripToneClasses,
} from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface StatStripItem {
  /** Stable key for keyed rendering + active-check. */
  key: string;
  /** Small uppercase label under the value. */
  label: string;
  /** The headline number / string / `NumberTicker`. */
  value: ComponentChildren;
  /** Lucide icon rendered in the icon well. */
  icon: LucideIcon;
  /** Tone override. Defaults to the strip's `accent`. */
  tone?: StripTone;
  /** If set, the cell becomes an `<a>` with this href. */
  href?: string;
  /** Renders the active-state ring + `aria-current="true"`. */
  active?: boolean;
  /**
   * When true and `value === 0`, the cell gets `aria-disabled`,
   * `pointer-events-none`, `opacity-50`, `tabIndex={-1}`.
   */
  disabledWhenZero?: boolean;
  /** Dashed border (used for "optional filter" cells, e.g. meta tags). */
  dashed?: boolean;
  /** Forces `amber` tone — semantic warning (e.g. overdue invoices > 0). */
  warn?: boolean;
  /** Optional title attribute for tooltip. */
  title?: string;
}

export interface StatStripProps {
  items: StatStripItem[];
  /** Page accent inherited from `PageCard.colorScheme`. Defaults to cyan. */
  accent?: AccentColor;
  /** Extra classes merged onto the outer grid. */
  class?: string;
}

/** Choose column classes based on cell count. 4, 5, or 6 columns at `lg`. */
function gridCols(count: number): string {
  if (count <= 4) return "sm:grid-cols-2 lg:grid-cols-4";
  if (count === 5) return "sm:grid-cols-3 lg:grid-cols-5";
  return "sm:grid-cols-3 lg:grid-cols-6";
}

/** Resolve an item's effective tone, honouring `warn` + fallback to accent. */
function resolveTone(item: StatStripItem, accent: AccentColor): StripTone {
  if (item.warn) return "amber";
  return item.tone ?? accent;
}

/** Zero-check that tolerates string/number/node values. */
function isZero(value: ComponentChildren): boolean {
  if (value === 0) return true;
  if (value === "0") return true;
  return false;
}

export function StatStrip(
  { items, accent = "cyan", class: className }: StatStripProps,
) {
  return (
    <div
      class={cn(
        "grid grid-cols-2 gap-3",
        gridCols(items.length),
        className,
      )}
    >
      {items.map((item) => {
        const tone = resolveTone(item, accent);
        const toneCls = stripToneClasses[tone];
        const disabled = item.disabledWhenZero === true && isZero(item.value);
        const Icon = item.icon;

        const cellClass = cn(
          "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          toneCls.cell,
          item.href && toneCls.hoverBorder,
          item.dashed && "border-dashed",
          disabled && "pointer-events-none opacity-50",
          item.active && toneCls.ring,
        );

        const inner = (
          <>
            <span
              class={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md",
                toneCls.iconWell,
              )}
              aria-hidden="true"
            >
              <Icon class="size-4" />
            </span>
            <div class="min-w-0">
              <p class="text-lg font-semibold leading-tight tabular-nums">
                {item.value}
              </p>
              <p class="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </p>
            </div>
          </>
        );

        if (item.href) {
          return (
            <a
              key={item.key}
              href={item.href}
              title={item.title}
              aria-current={item.active ? "true" : undefined}
              aria-disabled={disabled ? "true" : undefined}
              tabIndex={disabled ? -1 : undefined}
              class={cellClass}
            >
              {inner}
            </a>
          );
        }

        return (
          <div
            key={item.key}
            title={item.title}
            aria-disabled={disabled ? "true" : undefined}
            class={cellClass}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
