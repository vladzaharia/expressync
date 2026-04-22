/**
 * SyncStatusBadge — wraps StatusBadge for sync-run statuses.
 *
 *   pending  → muted + MinusCircle
 *   running  → info  + Loader2 (animate-spin)
 *   success  → success + CheckCircle2
 *   error    → destructive + AlertCircle
 *   warning  → warning + AlertTriangle
 *   skipped  → muted + MinusCircle
 *
 * `SegmentSyncStatusBadge` mirrors the `SegmentStatusBadge` logic previously
 * inlined inside `islands/SyncRunsTable.tsx`, including the "Unknown" /
 * "Pending" fallbacks when the segment status is null.
 */

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MinusCircle,
} from "lucide-preact";
import { StatusBadge, type StatusBadgeTone } from "./StatusBadge.tsx";

export type SyncStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "warning"
  | "skipped";

interface Props {
  status: SyncStatus | string;
  large?: boolean;
  className?: string;
}

const ICON_CLASS = "size-3";

const MAP: Record<
  SyncStatus,
  { tone: StatusBadgeTone; label: string; icon: preact.JSX.Element }
> = {
  pending: {
    tone: "muted",
    label: "Pending",
    icon: <MinusCircle class={ICON_CLASS} />,
  },
  running: {
    tone: "info",
    label: "Running",
    icon: <Loader2 class={`${ICON_CLASS} animate-spin`} />,
  },
  success: {
    tone: "success",
    label: "Success",
    icon: <CheckCircle2 class={ICON_CLASS} />,
  },
  error: {
    tone: "destructive",
    label: "Error",
    icon: <AlertCircle class={ICON_CLASS} />,
  },
  warning: {
    tone: "warning",
    label: "Warning",
    icon: <AlertTriangle class={ICON_CLASS} />,
  },
  skipped: {
    tone: "muted",
    label: "Skipped",
    icon: <MinusCircle class={ICON_CLASS} />,
  },
};

// Map "run overall" statuses that aren't in the core map.
const OVERALL_MAP: Record<
  string,
  { tone: StatusBadgeTone; label: string; icon: preact.JSX.Element }
> = {
  completed: {
    tone: "success",
    label: "Completed",
    icon: <CheckCircle2 class={ICON_CLASS} />,
  },
  failed: {
    tone: "destructive",
    label: "Failed",
    icon: <AlertCircle class={ICON_CLASS} />,
  },
};

export function SyncStatusBadge(
  { status, large, className }: Props,
) {
  const entry = MAP[status as SyncStatus] ?? OVERALL_MAP[status];
  if (!entry) {
    // Unknown status — fall back to a muted chip displaying the raw value.
    return (
      <StatusBadge
        tone="muted"
        label={status}
        large={large}
        className={className}
      />
    );
  }
  return (
    <StatusBadge
      tone={entry.tone}
      icon={entry.icon}
      label={entry.label}
      large={large}
      className={className}
    />
  );
}

interface SegmentProps {
  status: string | null;
  runCompleted: boolean;
  large?: boolean;
  className?: string;
}

/**
 * Segment-level variant used in the sync runs table. When `status` is null we
 * show a "Pending" badge if the run is still in flight, else "Unknown" to
 * distinguish a segment that never reported a result.
 */
export function SegmentSyncStatusBadge(
  { status, runCompleted, large, className }: SegmentProps,
) {
  if (!status) {
    return (
      <StatusBadge
        tone="muted"
        label={runCompleted ? "Unknown" : "Pending"}
        icon={<MinusCircle class={ICON_CLASS} />}
        large={large}
        className={className}
      />
    );
  }
  return (
    <SyncStatusBadge
      status={status}
      large={large}
      className={className}
    />
  );
}
