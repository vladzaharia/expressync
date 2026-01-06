import { Badge } from "@/components/ui/badge.tsx";
import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { Calendar, CheckCircle2, Clock, Hash, Zap } from "lucide-preact";
import type { TransactionSummary } from "@/routes/transactions/index.tsx";

interface Props {
  transactions: TransactionSummary[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
}

const columns: PaginatedTableColumn<TransactionSummary>[] = [
  {
    key: "steveTransactionId",
    header: "StEvE Transaction ID",
    render: (tx) => (
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-primary" />
        <span className="font-mono font-medium">{tx.steveTransactionId}</span>
      </div>
    ),
  },
  {
    key: "ocppTagId",
    header: "OCPP Tag",
    render: (tx) =>
      tx.ocppTagId
        ? (
          <div className="flex items-center gap-2">
            <Hash className="size-4 text-muted-foreground" />
            <span className="font-mono text-sm">{tx.ocppTagId}</span>
          </div>
        )
        : <span className="text-muted-foreground text-sm">—</span>,
  },
  {
    key: "totalKwhBilled",
    header: "kWh Billed",
    className: "text-right",
    render: (tx) => (
      <span className="font-medium tabular-nums">
        {tx.totalKwhBilled.toFixed(2)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (tx) =>
      tx.isFinalized
        ? (
          <Badge
            variant="outline"
            className="gap-1 text-success border-success/30 bg-success/10"
          >
            <CheckCircle2 className="size-3" />
            Complete
          </Badge>
        )
        : (
          <Badge
            variant="outline"
            className="gap-1 text-warning border-warning/30 bg-warning/10"
          >
            <Clock className="size-3" />
            In Progress
          </Badge>
        ),
  },
  {
    key: "lastSyncedAt",
    header: "Last Synced",
    className: "whitespace-nowrap",
    render: (tx) => (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Calendar className="size-4" />
        {tx.lastSyncedAt ? new Date(tx.lastSyncedAt).toLocaleString() : "—"}
      </div>
    ),
  },
];

export default function TransactionsTable({
  transactions,
  totalCount,
  pageSize = 15,
  showLoadMore = true,
}: Props) {
  const handleRowClick = (tx: TransactionSummary) => {
    globalThis.location.href = `/transactions/${tx.steveTransactionId}`;
  };

  return (
    <PaginatedTable
      initialItems={transactions}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/transaction/summary"
      showLoadMore={showLoadMore}
      emptyMessage="No transactions found. Transactions will appear here after syncing."
      onRowClick={handleRowClick}
      getItemKey={(tx) => tx.id}
    />
  );
}
