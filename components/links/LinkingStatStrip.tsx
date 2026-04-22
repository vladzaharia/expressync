/**
 * LinkingStatStrip — compact stats row above the `/links` grid.
 *
 * Four cells:
 *   1. Customers linked — distinct `lago_customer_external_id` count.
 *   2. Tags linked — total mapping rows.
 *   3. Meta-tags linked — mappings whose idTag starts with `OCPP-`.
 *   4. Unlinked-tag warning — number of OCPP tags without any mapping;
 *      renders as a tappable link to `/tags?filter=unlinked` when > 0.
 *
 * Server-rendered; no client state.
 */

import { AlertTriangle, Layers, Tag, Users } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

interface Totals {
  customersLinked: number;
  tagsLinked: number;
  metaTagsLinked: number;
  unlinkedTagCount: number;
}

interface Props {
  totals: Totals;
  class?: string;
}

interface CellProps {
  label: string;
  value: number;
  icon: preact.ComponentChildren;
  tone?: "violet" | "cyan" | "amber" | "muted";
  href?: string;
}

import type { ComponentChildren } from "preact";

function Cell(
  { label, value, icon, tone = "violet", href }: {
    label: string;
    value: number;
    icon: ComponentChildren;
    tone?: CellProps["tone"];
    href?: string;
  },
) {
  const toneClass = {
    violet:
      "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
    cyan: "border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-300",
    amber:
      "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    muted: "border-border bg-muted/20 text-foreground",
  }[tone];

  const inner = (
    <div
      class={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3",
        toneClass,
      )}
    >
      <span class="flex size-9 items-center justify-center rounded-md bg-background/80">
        {icon}
      </span>
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p class="text-lg font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        class="block transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-lg"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

export function LinkingStatStrip({ totals, class: className }: Props) {
  return (
    <div
      class={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4",
        className,
      )}
    >
      <Cell
        label="Customers linked"
        value={totals.customersLinked}
        icon={<Users class="size-4 text-violet-500" />}
        tone="violet"
      />
      <Cell
        label="Tags linked"
        value={totals.tagsLinked}
        icon={<Tag class="size-4 text-cyan-500" />}
        tone="cyan"
      />
      <Cell
        label="Meta-tags"
        value={totals.metaTagsLinked}
        icon={<Layers class="size-4 text-violet-500" />}
        tone="violet"
      />
      <Cell
        label="Unlinked tags"
        value={totals.unlinkedTagCount}
        icon={
          <AlertTriangle
            class={cn(
              "size-4",
              totals.unlinkedTagCount > 0
                ? "text-amber-500"
                : "text-muted-foreground",
            )}
          />
        }
        tone={totals.unlinkedTagCount > 0 ? "amber" : "muted"}
        href={totals.unlinkedTagCount > 0 ? "/tags?filter=unlinked" : undefined}
      />
    </div>
  );
}
