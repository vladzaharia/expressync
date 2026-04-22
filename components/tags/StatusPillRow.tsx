/**
 * Horizontal `flex-wrap` row of status pills. Used by the header strip on
 * every detail page (Tag, Charger, Linking).
 *
 * Each pill is an outlined badge with a colored leading dot. One pill may
 * opt into `live: true` which promotes it to `role="status"` so assistive
 * tech announces changes (e.g. an Active/Inactive toggle).
 */

import type { ComponentChildren } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";

export type PillTone =
  | "muted"
  | "neutral"
  | "emerald"
  | "amber"
  | "rose"
  | "cyan"
  | "violet"
  | "orange"
  | "sky";

const toneDot: Record<PillTone, string> = {
  muted: "bg-muted-foreground/60",
  neutral: "bg-foreground/60",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
  sky: "bg-sky-500",
};

export interface Pill {
  /** Short visible label. */
  label: string;
  /** Leading-dot color. `muted` when we're communicating absence of state. */
  tone?: PillTone;
  /** Optional icon rendered before the label. Already color-neutral — icon
   *  inherits text color via `currentColor`. */
  icon?: ComponentChildren;
  /** Optional `title` attribute — shown on hover; screen readers get the
   *  label alone. */
  title?: string;
  /** Marks this pill as representing live state (e.g. Active/Inactive).
   *  Maps to `role="status"` and adds `aria-live="polite"` so changes are
   *  announced. Default `false` — static pills are plain spans to avoid
   *  AT spam. */
  live?: boolean;
  /** Render a dashed border — used to mark "not set" pills
   *  (e.g. No active subscription). */
  dashed?: boolean;
}

interface Props {
  pills: Pill[];
  class?: string;
  /**
   * Visual variant:
   *   - `"default"` (default) — outer row gets `border bg-muted/30 px-3 py-2`.
   *     Use on detail pages where the pills live in their own strip.
   *   - `"bare"` — no outer chrome. Use when embedding the pill row inside
   *     another card (e.g. `TagListCard`) so the card's own padding + border
   *     provide the surrounding context.
   */
  variant?: "default" | "bare";
}

export function StatusPillRow(
  { pills, class: className, variant = "default" }: Props,
) {
  return (
    <div
      class={cn(
        "flex flex-wrap items-center gap-2",
        variant === "default" && "rounded-md border bg-muted/30 px-3 py-2",
        className,
      )}
    >
      {pills.map((p, i) => {
        const tone = p.tone ?? "muted";
        return (
          <span
            key={i}
            role={p.live ? "status" : undefined}
            aria-live={p.live ? "polite" : undefined}
            title={p.title}
            class={cn(
              "inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium",
              p.dashed && "border-dashed",
            )}
          >
            <span
              aria-hidden="true"
              class={cn("size-1.5 rounded-full", toneDot[tone])}
            />
            {p.icon ? <span class="flex items-center">{p.icon}</span> : null}
            <span>{p.label}</span>
          </span>
        );
      })}
    </div>
  );
}
