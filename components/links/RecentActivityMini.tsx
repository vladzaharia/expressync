/**
 * RecentActivityMini — aside panel on `/links/[id]` showing the last five
 * charging transactions for this tag. Server-rendered; rows link into the
 * charger detail page for drill-down.
 *
 * Props accept pre-formatted rows so we don't re-fetch StEvE inside the
 * component — keeps caching clean at the loader level.
 */

import { Activity, ArrowRight, Zap } from "lucide-preact";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { formatRelative } from "@/islands/shared/device-visuals.ts";

export interface RecentActivityRow {
  id: number;
  startTimestamp: string;
  stopTimestamp: string | null;
  kwh: number | null;
  chargeBoxId: string;
  friendlyName: string | null;
}

interface Props {
  rows: RecentActivityRow[];
  tagPk: number;
  class?: string;
}

export function RecentActivityMini({ rows, tagPk, class: className }: Props) {
  return (
    <SectionCard
      title="Recent activity"
      icon={Activity}
      accent="violet"
      className={className}
      actions={
        <a
          href={`/tags/${tagPk}#activity`}
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          See all
          <ArrowRight class="size-3" aria-hidden="true" />
        </a>
      }
    >
      {rows.length === 0
        ? (
          <p class="py-6 text-center text-xs text-muted-foreground">
            No charging sessions recorded for this tag yet.
          </p>
        )
        : (
          <ul class="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} class="py-2.5 first:pt-0 last:pb-0">
                <a
                  href={`/chargers/${encodeURIComponent(row.chargeBoxId)}`}
                  class="flex items-center justify-between gap-3 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-sm"
                >
                  <div class="min-w-0">
                    {row.friendlyName?.trim()
                      ? (
                        <p class="flex items-baseline gap-2 truncate text-xs text-foreground">
                          <span class="truncate font-medium">
                            {row.friendlyName.trim()}
                          </span>
                          <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {row.chargeBoxId}
                          </span>
                        </p>
                      )
                      : (
                        <p class="truncate font-mono text-xs text-foreground">
                          {row.chargeBoxId}
                        </p>
                      )}
                    <p
                      class="text-[11px] text-muted-foreground"
                      title={row.startTimestamp}
                    >
                      {formatRelative(row.startTimestamp)}
                      {row.stopTimestamp ? "" : " · active"}
                    </p>
                  </div>
                  <div
                    class={cn(
                      "flex items-center gap-1 text-xs tabular-nums",
                      row.kwh == null
                        ? "text-muted-foreground"
                        : "text-foreground",
                    )}
                  >
                    <Zap class="size-3" aria-hidden="true" />
                    {row.kwh == null ? "—" : `${row.kwh.toFixed(2)} kWh`}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
}
