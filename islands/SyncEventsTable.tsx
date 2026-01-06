import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
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
    // If run is completed but no status recorded, show "Unknown" instead of "Pending"
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

export default function SyncEventsTable({ syncRuns }: Props) {
  if (syncRuns.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No sync events recorded yet. Sync runs will appear here after the first
        sync.
      </div>
    );
  }

  const handleRowClick = (id: number) => {
    globalThis.location.href = `/sync/${id}`;
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tag Linking</TableHead>
          <TableHead>Transaction Sync</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {syncRuns.map((run) => {
          const isCompleted = run.status === "completed" ||
            run.status === "failed";
          return (
            <TableRow
              key={run.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleRowClick(run.id)}
            >
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  {formatDate(run.startedAt)}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDuration(run.startedAt, run.completedAt)}
              </TableCell>
              <TableCell>
                <OverallStatusBadge status={run.status} />
              </TableCell>
              <TableCell>
                <SegmentStatusBadge
                  status={run.tagLinkingStatus}
                  runCompleted={isCompleted}
                />
              </TableCell>
              <TableCell>
                <SegmentStatusBadge
                  status={run.transactionSyncStatus}
                  runCompleted={isCompleted}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
