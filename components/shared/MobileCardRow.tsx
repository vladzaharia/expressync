/**
 * MobileCardRow (Polaris Track H).
 *
 * Generic stacked-card layout for the `PaginatedTable.renderMobileCard`
 * mode. Used by `CustomerSessionsTable` and `CustomerInvoicesTable`
 * (Track G2/G3) so the customer-facing listings render a tap-friendly
 * card instead of the dense desktop table on `<md` viewports.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ topLeft (date · time)     topRight   │  ← header row (status badge etc.)
 *   │ secondaryLine                        │  ← muted secondary line
 *   │ primaryStat        secondaryStat     │  ← big stat + tail value
 *   └──────────────────────────────────────┘
 *
 * Whole card is the tap target (cursor + hover affordance + active scale).
 * The parent table wires the actual click handler; this component just
 * styles the click region.
 */

import type { ComponentChildren } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";

export interface MobileCardRowProps {
  /** Top-left header content — typically a date/time string. */
  topLeft: ComponentChildren;
  /** Top-right header content — typically a `StatusBadge`. */
  topRight: ComponentChildren;
  /**
   * Optional muted secondary line under the header — e.g. charger label,
   * connector chip, or invoice number.
   */
  secondaryLine?: ComponentChildren;
  /**
   * Big primary stat — e.g. "12.4 kWh / 1h 23m" or invoice total. Rendered
   * larger and tabular-nums for at-a-glance scanning.
   */
  primaryStat: ComponentChildren;
  /**
   * Tail-aligned secondary stat — e.g. cost or due date. Rendered smaller
   * but still emphasized for the trust-signal columns.
   */
  secondaryStat?: ComponentChildren;
  /** Extra classes merged onto the root card. */
  className?: string;
}

export function MobileCardRow({
  topLeft,
  topRight,
  secondaryLine,
  primaryStat,
  secondaryStat,
  className,
}: MobileCardRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-xs transition-colors",
        // Tap affordance — the parent attaches the actual onClick handler;
        // we only render the visual feedback so the list scans as tappable.
        "cursor-pointer hover:bg-muted/40 active:bg-muted/60 motion-safe:active:scale-[0.99]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground min-w-0 truncate">
          {topLeft}
        </div>
        <div className="shrink-0">{topRight}</div>
      </div>

      {secondaryLine !== undefined && secondaryLine !== null && (
        <div className="text-xs text-muted-foreground truncate">
          {secondaryLine}
        </div>
      )}

      <div className="flex items-end justify-between gap-3">
        <div className="text-base font-semibold tabular-nums text-foreground">
          {primaryStat}
        </div>
        {secondaryStat !== undefined && secondaryStat !== null && (
          <div className="text-sm font-medium tabular-nums text-muted-foreground">
            {secondaryStat}
          </div>
        )}
      </div>
    </div>
  );
}
