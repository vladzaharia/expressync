/**
 * TagsStatStrip — compact, clickable stat strip above the tag grid on `/tags`.
 *
 * Six cells, each a filter-shortcut `<a>`:
 *   1. Total tags           — cyan,    icon `Tag`,        href `/tags`
 *   2. Linked               — emerald, icon `Link2`,      href `/tags?linked=1`
 *   3. Unlinked             — amber,   icon `Unlink`,     href `/tags?linked=0`   (dashed)
 *   4. Meta-tags            — violet,  icon `Layers`,     href `/tags?meta=1`     (dashed)
 *   5. Inactive             — muted,   icon `CircleSlash`,href `/tags?active=0`
 *   6. Cards issued         — sky,     icon `CreditCard`, href `/tags?issued=1`
 *
 * Behavior:
 *   - Zero counts render with `opacity-50 pointer-events-none aria-disabled`
 *     so operators don't navigate into an empty filter view.
 *   - The cell matching the active URL filter (`active=*`) gets
 *     `ring-2 ring-<tone>-500/60` + `aria-current="true"`.
 *
 * Server-rendered — no client state.
 */

import type { ComponentChildren } from "preact";
import {
  CircleSlash,
  CreditCard,
  Layers,
  Link2,
  Tag,
  Unlink,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

export interface TagsStatStripTotals {
  all: number;
  linked: number;
  unlinked: number;
  meta: number;
  inactive: number;
  withIssuedCards: number;
}

/** Which stat-strip cell is currently selected by the URL filter, if any. */
export type TagsStatStripActive =
  | "all"
  | "linked"
  | "unlinked"
  | "meta"
  | "inactive"
  | "issued"
  | null;

type Tone = "cyan" | "emerald" | "amber" | "violet" | "muted" | "sky";

interface CellSpec {
  key: Exclude<TagsStatStripActive, null>;
  label: string;
  value: number;
  icon: ComponentChildren;
  tone: Tone;
  href: string;
  dashed?: boolean;
}

/**
 * Per-tone Tailwind class sets. Enumerated statically so JIT picks them up.
 */
const toneIconWell: Record<Tone, string> = {
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  muted: "bg-muted text-muted-foreground",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const toneHoverBorder: Record<Tone, string> = {
  cyan: "hover:border-cyan-500/60",
  emerald: "hover:border-emerald-500/60",
  amber: "hover:border-amber-500/60",
  violet: "hover:border-violet-500/60",
  muted: "hover:border-foreground/20",
  sky: "hover:border-sky-500/60",
};

const toneRing: Record<Tone, string> = {
  cyan: "ring-2 ring-cyan-500/60",
  emerald: "ring-2 ring-emerald-500/60",
  amber: "ring-2 ring-amber-500/60",
  violet: "ring-2 ring-violet-500/60",
  muted: "ring-2 ring-foreground/30",
  sky: "ring-2 ring-sky-500/60",
};

interface Props {
  totals: TagsStatStripTotals;
  /** Which filter is currently active — drives the ring + aria-current. */
  active?: TagsStatStripActive;
  class?: string;
}

export function TagsStatStrip(
  { totals, active = null, class: className }: Props,
) {
  const cells: CellSpec[] = [
    {
      key: "all",
      label: "Total tags",
      value: totals.all,
      icon: <Tag class="h-4 w-4" aria-hidden="true" />,
      tone: "cyan",
      href: "/tags",
    },
    {
      key: "linked",
      label: "Linked",
      value: totals.linked,
      icon: <Link2 class="h-4 w-4" aria-hidden="true" />,
      tone: "emerald",
      href: "/tags?linked=1",
    },
    {
      key: "unlinked",
      label: "Unlinked",
      value: totals.unlinked,
      icon: <Unlink class="h-4 w-4" aria-hidden="true" />,
      tone: "amber",
      href: "/tags?linked=0",
      dashed: true,
    },
    {
      key: "meta",
      label: "Meta-tags",
      value: totals.meta,
      icon: <Layers class="h-4 w-4" aria-hidden="true" />,
      tone: "violet",
      href: "/tags?meta=1",
      dashed: true,
    },
    {
      key: "inactive",
      label: "Inactive",
      value: totals.inactive,
      icon: <CircleSlash class="h-4 w-4" aria-hidden="true" />,
      tone: "muted",
      href: "/tags?active=0",
    },
    {
      key: "issued",
      label: "Cards issued",
      value: totals.withIssuedCards,
      icon: <CreditCard class="h-4 w-4" aria-hidden="true" />,
      tone: "sky",
      href: "/tags?issued=1",
    },
  ];

  return (
    <div
      class={cn(
        "grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-6",
        className,
      )}
    >
      {cells.map((cell) => {
        const isActive = active === cell.key;
        // "all" is always live (it's the reset link); others disable when zero.
        const isDisabled = cell.key !== "all" && cell.value === 0;

        return (
          <a
            key={cell.key}
            href={cell.href}
            aria-current={isActive ? "true" : undefined}
            aria-disabled={isDisabled ? "true" : undefined}
            tabIndex={isDisabled ? -1 : undefined}
            class={cn(
              "flex items-center gap-3 rounded-md border bg-background px-3 py-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              toneHoverBorder[cell.tone],
              cell.dashed && "border-dashed",
              isDisabled && "pointer-events-none opacity-50",
              isActive && toneRing[cell.tone],
            )}
          >
            <span
              class={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md",
                toneIconWell[cell.tone],
              )}
              aria-hidden="true"
            >
              {cell.icon}
            </span>
            <div class="min-w-0">
              <p class="text-lg font-semibold leading-none tabular-nums">
                {cell.value}
              </p>
              <p class="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {cell.label}
              </p>
            </div>
          </a>
        );
      })}
    </div>
  );
}
