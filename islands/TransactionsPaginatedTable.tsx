import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Zap, Hash, Calendar, Activity } from "lucide-preact";
import type { SyncedTransactionEvent } from "@/src/db/schema.ts";

interface Props {
  events: SyncedTransactionEvent[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

const columns: PaginatedTableColumn<SyncedTransactionEvent>[] = [
  {
    key: "transactionId",
    header: "Transaction ID",
    className: "font-mono",
    render: (event) => (
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-primary" />
        <span>{event.steveTransactionId}</span>
      </div>
    ),
  },
  {
    key: "ocppTag",
    header: "OCPP Tag",
    className: "font-mono text-sm",
    render: (event) => (
      <div className="flex items-center gap-2">
        <Hash className="size-4 text-muted-foreground" />
        <span>{event.ocppTagId}</span>
      </div>
    ),
  },
  {
    key: "kwh",
    header: "kWh",
    render: (event) => (
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-accent" />
        <span className="font-medium">{event.kwhDelta.toFixed(2)}</span>
        {event.isFinal && (
          <Badge variant="outline" className="text-xs">Final</Badge>
        )}
      </div>
    ),
  },
  {
    key: "lagoEventId",
    header: "Lago Event ID",
    className: "font-mono text-xs text-muted-foreground max-w-[200px] truncate",
    render: (event) => (
      <span title={event.lagoEventId}>{event.lagoEventId}</span>
    ),
  },
  {
    key: "syncedAt",
    header: "Synced At",
    className: "whitespace-nowrap",
    render: (event) => (
      <div className="flex items-center gap-2">
        <Calendar className="size-4 text-muted-foreground" />
        {formatDate(event.syncedAt)}
      </div>
    ),
  },
];

export default function TransactionsPaginatedTable({
  events,
  totalCount,
  pageSize = 15,
  showLoadMore = true,
}: Props) {
  const handleRowClick = (event: SyncedTransactionEvent) => {
    globalThis.location.href = `/transactions/${event.steveTransactionId}`;
  };

  return (
    <PaginatedTable
      initialItems={events}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/transactions"
      showLoadMore={showLoadMore}
      emptyMessage="No billing events found"
      onRowClick={handleRowClick}
      getItemKey={(event) => event.id}
    />
  );
}

