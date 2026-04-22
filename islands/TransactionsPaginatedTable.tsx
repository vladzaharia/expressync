import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Activity, Calendar, Hash, Zap } from "lucide-preact";
import type { SyncedTransactionEvent } from "@/src/db/schema.ts";
import { formatDate } from "@/src/lib/utils/format.ts";

type TransactionEventWithTag = SyncedTransactionEvent & {
  ocppTag?: string | null;
};

interface Props {
  events: TransactionEventWithTag[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
}

const columns: PaginatedTableColumn<TransactionEventWithTag>[] = [
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
        <span>{event.ocppTag ?? "—"}</span>
      </div>
    ),
  },
  {
    key: "kwh",
    header: "kWh",
    render: (event) => (
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-accent" />
        <span className="font-medium">{Number(event.kwhDelta).toFixed(2)}</span>
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
      <span title={event.lagoEventTransactionId}>{event.lagoEventTransactionId}</span>
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
  const handleRowClick = (event: TransactionEventWithTag) => {
    globalThis.location.href = `/transactions/${event.steveTransactionId}`;
  };

  return (
    <PaginatedTable<TransactionEventWithTag>
      initialItems={events}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/transaction"
      showLoadMore={showLoadMore}
      emptyMessage="No billing events found"
      onRowClick={handleRowClick}
      getItemKey={(event) => event.id}
    />
  );
}
