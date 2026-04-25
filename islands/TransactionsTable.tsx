import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { Calendar, Hash, Zap } from "lucide-preact";
import { TransactionStatusBadge } from "@/components/shared/index.ts";
import type { TransactionSummary } from "@/routes/admin/transactions/index.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  transactions: TransactionSummary[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
  fetchParams?: Record<string, string>;
  emptyMessage?: string;
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
        {Number(tx.totalKwhBilled).toFixed(2)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (tx) => (
      <TransactionStatusBadge
        status={tx.isFinalized ? "completed" : "in_progress"}
      />
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
  fetchParams,
  emptyMessage =
    "No charging sessions found. Sessions will appear here after syncing.",
}: Props) {
  const handleRowClick = (tx: TransactionSummary) => {
    clientNavigate(`/transactions/${tx.steveTransactionId}`);
  };

  return (
    <PaginatedTable
      initialItems={transactions}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/admin/transaction/summary"
      fetchParams={fetchParams}
      showLoadMore={showLoadMore}
      emptyMessage={emptyMessage}
      onRowClick={handleRowClick}
      getItemKey={(tx) => tx.id}
    />
  );
}
