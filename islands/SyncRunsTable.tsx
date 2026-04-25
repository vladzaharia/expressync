import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { Clock } from "lucide-preact";
import {
  SegmentSyncStatusBadge,
  SyncStatusBadge,
} from "@/components/shared/index.ts";
import type { SyncRun } from "@/src/db/schema.ts";
import { formatDate, formatDuration } from "@/src/lib/utils/format.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  syncRuns: SyncRun[];
  totalCount?: number;
  pageSize?: number;
  showLoadMore?: boolean;
  hideHeader?: boolean;
  hideFooterText?: boolean;
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
    render: (run) => <SyncStatusBadge status={run.status} />,
  },
  {
    key: "tagLinking",
    header: "Tag Linking",
    hideOnMobile: true,
    render: (run) => {
      const isCompleted = run.status === "completed" || run.status === "failed";
      return (
        <SegmentSyncStatusBadge
          status={run.tagLinkingStatus}
          runCompleted={isCompleted}
        />
      );
    },
  },
  {
    key: "transactionSync",
    header: "Transaction Sync",
    hideOnMobile: true,
    render: (run) => {
      const isCompleted = run.status === "completed" || run.status === "failed";
      return (
        <SegmentSyncStatusBadge
          status={run.transactionSyncStatus}
          runCompleted={isCompleted}
        />
      );
    },
  },
];

export default function SyncRunsTable({
  syncRuns,
  totalCount,
  pageSize = 15,
  showLoadMore = true,
  hideHeader = false,
  hideFooterText = false,
}: Props) {
  const handleRowClick = (run: SyncRun) => {
    clientNavigate(`/sync/${run.id}`);
  };

  return (
    <PaginatedTable
      initialItems={syncRuns}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl="/api/admin/sync"
      showLoadMore={showLoadMore}
      emptyMessage="No sync events recorded yet. Sync runs will appear here after the first sync."
      onRowClick={handleRowClick}
      getItemKey={(run: SyncRun) => run.id}
      hideHeader={hideHeader}
      hideFooterText={hideFooterText}
    />
  );
}
