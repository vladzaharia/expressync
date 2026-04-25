import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Activity, Calendar, Hash, Loader2, Square, Zap } from "lucide-preact";
import { toast } from "sonner";
import { useSignal } from "@preact/signals";
import type { SyncedTransactionEvent } from "@/src/db/schema.ts";
import { formatDate } from "@/src/lib/utils/format.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

/**
 * Row shape for this table. Core fields come from SyncedTransactionEvent
 * (billing events). The trailing fields are OPTIONAL context that callers
 * with access to live StEvE transaction state can populate so active-session
 * rows can surface the Phase E1 Remote Stop button.
 *
 * When `stopTimestamp === null`, we render an inline red Stop button in the
 * actions column. Clicking it POSTs to `/api/admin/charger/operation` with
 * `operation: "RemoteStopTransaction"`. After success, a 5-second Undo toast
 * offers to re-issue `RemoteStartTransaction` with the original ocppIdTag +
 * connectorId.
 */
export type TransactionEventWithTag = SyncedTransactionEvent & {
  ocppTag?: string | null;
  /** ISO timestamp from the source StEvE transaction; null means in-progress. */
  stopTimestamp?: string | null;
  /** StEvE charge box identifier — required for the Stop API call. */
  chargeBoxId?: string | null;
  /** StEvE connector number — used when issuing the Undo RemoteStart. */
  connectorId?: number | null;
  /** Live StEvE transactionId — required for RemoteStopTransaction. */
  transactionId?: number | null;
  /** Prior ocppIdTag — used when issuing the Undo RemoteStart. */
  ocppIdTag?: string | null;
};

interface Props {
  events: TransactionEventWithTag[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
}

/**
 * Small island-local helper that wraps the Stop button + optimistic state.
 * Kept inline so the table does not need an extra island boundary.
 */
function StopButton({ event }: { event: TransactionEventWithTag }) {
  const status = useSignal<"idle" | "stopping" | "stopped" | "failed">("idle");

  const canStop = event.stopTimestamp === null &&
    typeof event.chargeBoxId === "string" &&
    typeof event.transactionId === "number";

  if (!canStop) return null;

  const handleStop = async (e: Event) => {
    e.stopPropagation();
    if (status.value !== "idle") return;
    status.value = "stopping";

    // Hard-revert guard — keep the spinner for at most 10s even if the
    // network hangs so the user isn't stuck (matches Phase E5 risk plan).
    const revertTimer = setTimeout(() => {
      if (status.value === "stopping") {
        status.value = "failed";
        toast.error("Stop timed out — retry?");
      }
    }, 10_000);

    try {
      const response = await fetch("/api/admin/charger/operation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: event.chargeBoxId,
          operation: "RemoteStopTransaction",
          params: { transactionId: event.transactionId },
        }),
      });

      clearTimeout(revertTimer);

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        status.value = "failed";
        toast.error(errBody.error ?? "Failed to stop transaction", {
          action: {
            label: "Retry",
            onClick: () => {
              status.value = "idle";
              handleStop(new Event("retry"));
            },
          },
        });
        return;
      }

      status.value = "stopped";
      // 5s undo window — re-issue RemoteStart with original connector + tag.
      toast.success(`Stop requested for tx ${event.transactionId}`, {
        duration: 5000,
        action: event.ocppIdTag
          ? {
            label: "Undo",
            onClick: async () => {
              try {
                const undoRes = await fetch("/api/admin/charger/operation", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chargeBoxId: event.chargeBoxId,
                    operation: "RemoteStartTransaction",
                    params: {
                      idTag: event.ocppIdTag,
                      connectorId: event.connectorId ?? undefined,
                    },
                  }),
                });
                if (!undoRes.ok) {
                  const b = await undoRes.json().catch(() => ({}));
                  toast.error(b.error ?? "Undo failed");
                } else {
                  toast.success("Restart requested");
                  status.value = "idle";
                }
              } catch {
                toast.error("Undo failed");
              }
            },
          }
          : undefined,
      });
    } catch (error) {
      clearTimeout(revertTimer);
      status.value = "failed";
      toast.error(
        error instanceof Error ? error.message : "Failed to stop transaction",
      );
    }
  };

  if (status.value === "stopping") {
    return (
      <Button
        variant="destructive"
        size="sm"
        disabled
        className="gap-1"
      >
        <Loader2 className="size-3 animate-spin" />
        Stopping…
      </Button>
    );
  }
  if (status.value === "stopped") {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-muted-foreground border-muted"
      >
        Stopped
      </Badge>
    );
  }
  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleStop}
      className="gap-1"
    >
      <Square className="size-3" />
      Stop
    </Button>
  );
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
      <span title={event.lagoEventTransactionId}>
        {event.lagoEventTransactionId}
      </span>
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
  {
    key: "actions",
    header: "",
    className: "w-0",
    render: (event) => <StopButton event={event} />,
  },
];

export default function TransactionsPaginatedTable({
  events,
  totalCount,
  pageSize = 15,
  showLoadMore = true,
}: Props) {
  const handleRowClick = (event: TransactionEventWithTag) => {
    clientNavigate(`/transactions/${event.steveTransactionId}`);
  };

  return (
    <PaginatedTable<TransactionEventWithTag>
      initialItems={events}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/admin/transaction"
      showLoadMore={showLoadMore}
      emptyMessage="No billing events found"
      onRowClick={handleRowClick}
      getItemKey={(event) => event.id}
    />
  );
}
