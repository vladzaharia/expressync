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

import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import {
  MobileCardRow,
  TransactionStatusBadge,
} from "@/components/shared/index.ts";
import { Calendar, Tag as TagIcon, Zap } from "lucide-preact";

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

const columns: PaginatedTableColumn<CustomerSessionRow>[] = [
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
    render: (row) => <span class="font-medium tabular-nums">{rowKwh(row)}
    </span>,
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <TransactionStatusBadge
        status={row.isFinal ? "completed" : "in_progress"}
      />
    ),
  },
];

export default function CustomerSessionsTable({
  sessions,
  totalCount,
  pageSize = 25,
  fetchParams,
  emptyMessage = "No charging sessions yet.",
}: Props) {
  const handleRowClick = (row: CustomerSessionRow) => {
    globalThis.location.href = `/sessions/${row.id}`;
  };

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
      renderMobileCard={(row) => (
        <MobileCardRow
          topLeft={formatDate(row.syncedAt)}
          topRight={
            <TransactionStatusBadge
              status={row.isFinal ? "completed" : "in_progress"}
            />
          }
          secondaryLine={row.ocppTag
            ? <span class="font-mono">{row.ocppTag}</span>
            : `Session #${row.steveTransactionId}`}
          primaryStat={`${rowKwh(row)} kWh`}
        />
      )}
    />
  );
}
