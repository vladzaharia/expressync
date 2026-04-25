/**
 * Polaris Track G2 — customer-facing Sessions list table.
 *
 * Wraps `PaginatedTable` with:
 *   - Desktop columns: Date, Charger, Tag, kWh, Duration, Cost, Status
 *   - Mobile: `renderMobileCard` returns a `MobileCardRow` (Track H helper)
 *   - Row click → `/sessions/[id]`
 *   - `fetchUrl` points at `/api/customer/sessions` so Load More re-uses the
 *     same scope-checked endpoint the loader called server-side.
 *
 * The customer Sessions list shows one row per `synced_transaction_events`
 * row (matching the Track F response shape — see `customer-sessions/index.ts`).
 * That keeps the filter shortcuts (`?status=active`) consistent with the API.
 */

import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import {
  MobileCardRow,
  TransactionStatusBadge,
} from "@/components/shared/index.ts";
import { NumberTicker } from "@/components/magicui/number-ticker.tsx";
import { Calendar, Tag as TagIcon, Zap } from "lucide-preact";
import { clientNavigate } from "@/src/lib/nav.ts";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

/**
 * Row shape — matches the Track F `/api/customer/sessions` items. We only
 * pick the fields the table renders; the loader passes through the full
 * payload so additional fields would arrive with a single columns-array
 * change here.
 */
export interface CustomerSessionRow {
  id: number;
  steveTransactionId: number;
  ocppTag: string | null;
  kwhDelta: string | number;
  meterValueFrom: number;
  meterValueTo: number;
  isFinal: boolean | null;
  syncedAt: string | null;
}

interface Props {
  sessions: CustomerSessionRow[];
  totalCount?: number;
  pageSize?: number;
  fetchParams?: Record<string, string>;
  emptyMessage?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }) + " · " + d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rowKwh(row: CustomerSessionRow): string {
  // Use the per-event delta — the API returns one event per row and the
  // delta is what the customer was charged for in that interval.
  const delta = typeof row.kwhDelta === "string"
    ? parseFloat(row.kwhDelta)
    : row.kwhDelta;
  if (!Number.isFinite(delta)) return "0.00";
  return delta.toFixed(2);
}

interface LiveTick {
  kwh: number;
  kw: number;
}

/**
 * Module-scoped live-meter map shared across all rows in the table. Keyed
 * by `steveTransactionId`. The signal identity changes on every update so
 * Preact re-renders all rows that read it.
 */
const liveMetersSignal = signal<Map<number, LiveTick>>(new Map());

interface MeterPayload {
  transactionId: number | string;
  kwh?: number;
  powerKw?: number;
  endedAt?: string;
}

function applyMeterUpdate(p: MeterPayload): void {
  const txId = typeof p.transactionId === "string"
    ? parseInt(p.transactionId, 10)
    : p.transactionId;
  if (!Number.isFinite(txId)) return;
  const prev = liveMetersSignal.value;
  const existing = prev.get(txId);
  const nextKwh = typeof p.kwh === "number" && Number.isFinite(p.kwh)
    ? Math.max(existing?.kwh ?? 0, p.kwh)
    : existing?.kwh ?? 0;
  const nextKw = typeof p.powerKw === "number" && Number.isFinite(p.powerKw)
    ? p.powerKw
    : existing?.kw ?? 0;
  const next = new Map(prev);
  next.set(txId, { kwh: nextKwh, kw: nextKw });
  liveMetersSignal.value = next;
}

function buildColumns(): PaginatedTableColumn<CustomerSessionRow>[] {
  return [
    {
      key: "syncedAt",
      header: "Date",
      className: "whitespace-nowrap",
      render: (row) => (
        <div class="flex items-center gap-2 text-sm">
          <Calendar class="size-4 text-muted-foreground" />
          {formatDate(row.syncedAt)}
        </div>
      ),
    },
    {
      key: "session",
      header: "Session",
      hideOnMobile: true,
      render: (row) => (
        <div class="flex items-center gap-2">
          <Zap class="size-4 text-primary" />
          <span class="font-mono text-sm">#{row.steveTransactionId}</span>
        </div>
      ),
    },
    {
      key: "tag",
      header: "Card",
      hideOnMobile: true,
      render: (row) =>
        row.ocppTag
          ? (
            <div class="flex items-center gap-2 text-muted-foreground text-sm">
              <TagIcon class="size-4" />
              <span class="font-mono">{row.ocppTag}</span>
            </div>
          )
          : <span class="text-muted-foreground text-sm">—</span>,
    },
    {
      key: "kwh",
      header: "kWh",
      className: "text-right",
      render: (row) => {
        const live = row.isFinal === false
          ? liveMetersSignal.value.get(row.steveTransactionId)
          : undefined;
        if (live && live.kwh > 0) {
          return (
            <span class="font-medium tabular-nums">
              <NumberTicker
                value={live.kwh}
                decimalPlaces={2}
                duration={400}
              />
            </span>
          );
        }
        return (
          <span class="font-medium tabular-nums">{rowKwh(row)}</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span class="inline-flex items-center gap-2">
          <TransactionStatusBadge
            status={row.isFinal ? "completed" : "in_progress"}
          />
          {row.isFinal === false && (
            <span
              aria-hidden="true"
              class="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse"
            />
          )}
        </span>
      ),
    },
  ];
}

export default function CustomerSessionsTable({
  sessions,
  totalCount,
  pageSize = 25,
  fetchParams,
  emptyMessage = "No charging sessions yet.",
}: Props) {
  const handleRowClick = (row: CustomerSessionRow) => {
    clientNavigate(`/sessions/${row.id}`);
  };

  // Subscribe once at the table level so we hold a single SSE listener for
  // all active rows. Inactive rows ignore the signal entirely.
  useEffect(() => {
    const hasActive = sessions.some((s) => s.isFinal === false);
    if (!hasActive) return;
    const unsub = subscribeSse("transaction.meter", (raw) => {
      applyMeterUpdate(raw as MeterPayload);
    });
    return unsub;
  }, [sessions]);

  const columns = buildColumns();

  return (
    <PaginatedTable
      initialItems={sessions}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/customer/sessions"
      fetchParams={fetchParams}
      emptyMessage={emptyMessage}
      onRowClick={handleRowClick}
      getItemKey={(row) => row.id}
      rowClassName={(row) =>
        cn(
          row.isFinal === false &&
            "border-l-2 border-l-emerald-500/40 bg-emerald-500/[0.02]",
        )}
      renderMobileCard={(row) => {
        const live = row.isFinal === false
          ? liveMetersSignal.value.get(row.steveTransactionId)
          : undefined;
        const kwhDisplay = live && live.kwh > 0
          ? live.kwh.toFixed(2)
          : rowKwh(row);
        return (
          <div
            data-active={row.isFinal === false ? "true" : undefined}
            class={cn(
              row.isFinal === false &&
                "rounded-md border-l-2 border-l-emerald-500/40 pl-2",
            )}
          >
            <MobileCardRow
              topLeft={formatDate(row.syncedAt)}
              topRight={
                <span class="inline-flex items-center gap-2">
                  <TransactionStatusBadge
                    status={row.isFinal ? "completed" : "in_progress"}
                  />
                  {row.isFinal === false && (
                    <span
                      aria-hidden="true"
                      class="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse"
                    />
                  )}
                </span>
              }
              secondaryLine={row.ocppTag
                ? <span class="font-mono">{row.ocppTag}</span>
                : `Session #${row.steveTransactionId}`}
              primaryStat={`${kwhDisplay} kWh`}
            />
          </div>
        );
      }}
    />
  );
}
