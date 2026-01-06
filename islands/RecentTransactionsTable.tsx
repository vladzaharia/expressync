import type { SyncedTransactionEvent } from "@/src/db/schema.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Clock, Zap } from "lucide-preact";

interface Props {
  transactions: SyncedTransactionEvent[];
  hideHeader?: boolean;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function RecentTransactionsTable({
  transactions,
  hideHeader = false,
}: Props) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Zap className="size-8 mx-auto mb-2 opacity-50" />
        <p>No transactions yet</p>
      </div>
    );
  }

  return (
    <Table>
      {!hideHeader && (
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Transaction</TableHead>
            <TableHead>Tag</TableHead>
            <TableHead className="text-right">kWh</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {transactions.map((tx) => (
          <TableRow key={tx.id}>
            <TableCell className="font-mono text-xs">
              <a
                href={`/transactions/${tx.steveTransactionId}`}
                className="hover:text-primary transition-colors"
              >
                #{tx.steveTransactionId}
              </a>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="font-mono text-xs">
                {tx.ocppIdTag}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-medium">
              {tx.kwhDelta.toFixed(2)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground text-xs">
              <span className="flex items-center justify-end gap-1">
                <Clock className="size-3" />
                {formatRelativeTime(new Date(tx.syncedAt))}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
