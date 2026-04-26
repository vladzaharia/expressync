/**
 * Recent-transactions section on `/chargers/[chargeBoxId]`.
 *
 * Purpose-built wrapper — we don't extend `TransactionsPaginatedTable` here
 * because (a) its fetchUrl doesn't accept a chargeBoxId filter and (b) the
 * plan wants charger-specific columns (Connector, Stop reason) that would
 * pollute the dashboard island. Initial rows come straight from StEvE via
 * the loader; the small `Show more` affordance navigates to the full
 * `/transactions?chargeBoxId=…` view.
 */

import { Badge } from "@/components/ui/badge.tsx";
import { TagChip } from "@/components/tags/TagChip.tsx";
import { Activity, Calendar, Hash, Zap } from "lucide-preact";
import { formatRelative } from "./shared/device-visuals.ts";

export interface ChargerRecentTxRow {
  steveTransactionId: number;
  chargeBoxId: string;
  connectorId: number;
  idTag: string;
  ocppTagPk: number | null;
  tagType: string | null;
  startedAtIso: string;
  stoppedAtIso: string | null;
  stopReason: string | null;
  kwhDelivered: number | null;
}

interface Props {
  chargeBoxId: string;
  rows: ChargerRecentTxRow[];
  steveFetchFailed: boolean;
}

export default function ChargerRecentTransactionsSection(
  { chargeBoxId, rows, steveFetchFailed }: Props,
) {
  return (
    <section
      aria-label="Recent transactions"
      class="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Recent transactions</h2>
        <a
          href={`/transactions?chargeBoxId=${encodeURIComponent(chargeBoxId)}`}
          class="text-xs text-primary underline-offset-4 hover:underline"
        >
          View all →
        </a>
      </div>

      {steveFetchFailed && (
        <div
          role="alert"
          class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          StEvE was unreachable — recent transactions may be missing.
        </div>
      )}

      {rows.length === 0
        ? (
          <div class="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No transactions recorded for this charger.
          </div>
        )
        : (
          <div
            role="region"
            aria-label="Recent transaction rows"
            tabIndex={0}
            class="overflow-x-auto"
          >
            <table class="w-full text-sm">
              <thead class="text-xs text-muted-foreground">
                <tr class="border-b">
                  <th class="py-2 text-left font-medium">Tx</th>
                  <th class="py-2 text-left font-medium">Connector</th>
                  <th class="py-2 text-left font-medium">Tag</th>
                  <th class="hidden py-2 text-left font-medium sm:table-cell">
                    Started
                  </th>
                  <th class="hidden py-2 text-left font-medium sm:table-cell">
                    kWh
                  </th>
                  <th class="hidden py-2 text-left font-medium md:table-cell">
                    Stop reason
                  </th>
                  <th class="py-2 text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isActive = r.stoppedAtIso === null;
                  return (
                    <tr
                      key={r.steveTransactionId}
                      class="border-b last:border-b-0"
                    >
                      <td class="py-2">
                        <a
                          href={`/transactions/${r.steveTransactionId}`}
                          class="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                        >
                          <Zap class="size-3.5 text-primary" />
                          #{r.steveTransactionId}
                        </a>
                      </td>
                      <td class="py-2 font-mono text-xs">{r.connectorId}</td>
                      <td class="py-2">
                        {r.ocppTagPk
                          ? (
                            <TagChip
                              idTag={r.idTag}
                              tagPk={r.ocppTagPk}
                              tagType={r.tagType}
                            />
                          )
                          : (
                            <span class="inline-flex items-center gap-1 font-mono text-xs">
                              <Hash class="size-3.5 text-muted-foreground" />
                              {r.idTag}
                            </span>
                          )}
                      </td>
                      <td class="hidden py-2 text-xs text-muted-foreground sm:table-cell">
                        <span
                          class="inline-flex items-center gap-1"
                          title={r.startedAtIso}
                        >
                          <Calendar class="size-3.5" />
                          {formatRelative(r.startedAtIso)}
                        </span>
                      </td>
                      <td class="hidden py-2 sm:table-cell">
                        <span class="inline-flex items-center gap-1 text-xs">
                          <Activity class="size-3.5 text-accent" />
                          {r.kwhDelivered !== null
                            ? r.kwhDelivered.toFixed(2)
                            : "—"}
                        </span>
                      </td>
                      <td class="hidden py-2 md:table-cell">
                        <span class="text-xs text-muted-foreground">
                          {r.stopReason ?? (isActive ? "—" : "unknown")}
                        </span>
                      </td>
                      <td class="py-2">
                        {isActive
                          ? (
                            <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                              <span class="relative flex size-1.5">
                                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span class="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                              </span>
                              Live
                            </span>
                          )
                          : (
                            <Badge variant="outline" class="text-[10px]">
                              Ended
                            </Badge>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
