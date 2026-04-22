/**
 * Recent StEvE transactions for a single tag — full-width section on
 * `/tags/[tagPk]`. Server-rendered.
 *
 * Rows are already pre-joined with `synced_transaction_events` by the loader
 * so we can surface the last sync timestamp per transaction.
 */

import { ExternalLink, Zap } from "lucide-preact";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { formatRelative } from "@/islands/shared/charger-visuals.ts";

export interface RecentTransactionRow {
  steveTransactionId: number;
  chargeBoxId: string;
  connectorId: number;
  startedAt: string;
  stoppedAt: string | null;
  /** Kilowatt-hours delivered for this tx (may be 0 while still active). */
  kwhDelivered: number | null;
  /** ISO timestamp of the most recent Lago sync event for this tx. */
  lastSyncedAt: string | null;
}

interface Props {
  idTag: string;
  rows: RecentTransactionRow[];
  /** Soft banner when StEvE fetch failed. Still render an empty table. */
  steveFetchFailed?: boolean;
}

function fmtAbsolute(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(startIso: string, stopIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = stopIso ? new Date(stopIso).getTime() : Date.now();
  const diff = end - start;
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const totalMin = Math.floor(diff / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function fmtKwh(kwh: number | null): string {
  if (kwh === null || !Number.isFinite(kwh)) return "—";
  if (kwh === 0) return "0 kWh";
  if (kwh < 0.1) return `${(kwh * 1000).toFixed(0)} Wh`;
  return `${kwh.toFixed(2)} kWh`;
}

export function TagRecentTransactionsSection(
  { idTag, rows, steveFetchFailed }: Props,
) {
  return (
    <Card id="activity">
      <CardHeader class="flex flex-row items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Zap class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle class="text-base">Recent charging</CardTitle>
          {rows.length > 0
            ? (
              <Badge variant="outline" class="font-normal">
                last {rows.length}
              </Badge>
            )
            : null}
        </div>
        <a
          href={`/transactions?idTag=${encodeURIComponent(idTag)}`}
          class="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View all →
        </a>
      </CardHeader>
      <CardContent>
        {steveFetchFailed
          ? (
            <div class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              StEvE is unreachable — showing cached data only.
            </div>
          )
          : null}
        {rows.length === 0
          ? (
            <div class="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
              <Zap class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p class="text-sm font-medium">No charging sessions yet</p>
              <p class="text-xs text-muted-foreground">
                When this tag authorizes a session, it will appear here.
              </p>
            </div>
          )
          : (
            <div
              role="region"
              aria-label="Recent charging sessions"
              tabindex={0}
              class="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <table class="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr class="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class="px-3 py-2 font-medium">Tx</th>
                    <th class="px-3 py-2 font-medium">Charger</th>
                    <th class="px-3 py-2 font-medium">Started</th>
                    <th class="hidden px-3 py-2 font-medium sm:table-cell">
                      Duration
                    </th>
                    <th class="px-3 py-2 font-medium">kWh</th>
                    <th class="hidden px-3 py-2 font-medium md:table-cell">
                      Synced
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const active = r.stoppedAt === null;
                    return (
                      <tr
                        key={r.steveTransactionId}
                        class="border-b last:border-b-0"
                      >
                        <td class="px-3 py-2 align-top font-mono text-xs">
                          <div class="flex items-center gap-1.5">
                            <span>#{r.steveTransactionId}</span>
                            {active
                              ? (
                                <span
                                  class="inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
                                  title="Still charging"
                                >
                                  Live
                                </span>
                              )
                              : null}
                          </div>
                        </td>
                        <td class="px-3 py-2 align-top">
                          <a
                            href={`/chargers/${
                              encodeURIComponent(r.chargeBoxId)
                            }`}
                            class={cn(
                              "inline-flex items-center gap-1 rounded-md border border-orange-500/40 bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            )}
                          >
                            <ExternalLink
                              class="h-3 w-3 text-orange-500"
                              aria-hidden="true"
                            />
                            <code class="font-mono">{r.chargeBoxId}</code>
                            <span class="text-muted-foreground">
                              · C{r.connectorId}
                            </span>
                          </a>
                        </td>
                        <td class="px-3 py-2 align-top">
                          <div
                            class="whitespace-nowrap text-xs"
                            title={fmtAbsolute(r.startedAt)}
                          >
                            {fmtAbsolute(r.startedAt)}
                          </div>
                          <div class="text-xs text-muted-foreground">
                            {formatRelative(r.startedAt)}
                          </div>
                        </td>
                        <td class="hidden px-3 py-2 align-top text-xs sm:table-cell">
                          {fmtDuration(r.startedAt, r.stoppedAt)}
                        </td>
                        <td class="px-3 py-2 align-top text-xs font-medium">
                          {fmtKwh(r.kwhDelivered)}
                        </td>
                        <td
                          class="hidden px-3 py-2 align-top text-xs text-muted-foreground md:table-cell"
                          title={r.lastSyncedAt
                            ? fmtAbsolute(r.lastSyncedAt)
                            : "Never synced"}
                        >
                          {r.lastSyncedAt
                            ? formatRelative(r.lastSyncedAt)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
