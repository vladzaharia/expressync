import { Badge } from "@/components/ui/badge.tsx";
import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
} from "lucide-preact";
import type { SyncRun } from "@/src/db/schema.ts";

interface Props {
  syncRuns: SyncRun[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "Running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function SegmentStatusBadge({
  status,
  runCompleted,
}: {
  status: string | null;
  runCompleted: boolean;
}) {
  if (!status) {
    if (runCompleted) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <MinusCircle className="size-3 mr-1" />
          Unknown
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <MinusCircle className="size-3 mr-1" />
        Pending
      </Badge>
    );
  }

  switch (status) {
    case "success":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="size-3" />
          Success
        </Badge>
      );
    case "warning":
      return (
        <Badge variant="warning" className="gap-1">
          <AlertTriangle className="size-3" />
          Warning
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="size-3" />
          Error
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="secondary" className="gap-1">
          <MinusCircle className="size-3" />
          Skipped
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function OverallStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="size-3" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="size-3" />
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

const columns: PaginatedTableColumn<SyncRun>[] = [
  {
    key: "started",
    header: "Started",
    className: "whitespace-nowrap",
    render: (run) => (
      <div className="flex items-center gap-2">
        <Clock className="size-4 text-muted-foreground" />
        {formatDate(run.startedAt)}
      </div>
    ),
  },
  {
    key: "duration",
    header: "Duration",
    className: "text-muted-foreground",
    render: (run) => formatDuration(run.startedAt, run.completedAt),
  },
  {
    key: "status",
    header: "Status",
    render: (run) => <OverallStatusBadge status={run.status} />,
  },
  {
    key: "tagLinking",
    header: "Tag Linking",
    render: (run) => {
      const isCompleted = run.status === "completed" || run.status === "failed";
      return <SegmentStatusBadge status={run.tagLinkingStatus} runCompleted={isCompleted} />;
    },
  },
  {
    key: "transactionSync",
    header: "Transaction Sync",
    render: (run) => {
      const isCompleted = run.status === "completed" || run.status === "failed";
      return <SegmentStatusBadge status={run.transactionSyncStatus} runCompleted={isCompleted} />;
    },
  },
];

export default function SyncRunsTable({
  syncRuns,
  totalCount,
  pageSize = 15,
  showLoadMore = true,
}: Props) {
  const handleRowClick = (run: SyncRun) => {
    globalThis.location.href = `/sync/${run.id}`;
  };

  return (
    <PaginatedTable
      initialItems={syncRuns}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/sync/runs"
      showLoadMore={showLoadMore}
      emptyMessage="No sync events recorded yet. Sync runs will appear here after the first sync."
      onRowClick={handleRowClick}
      getItemKey={(run) => run.id}
    />
  );
}

