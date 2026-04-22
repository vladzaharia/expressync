/**
 * ReservationStatusBadge — wraps StatusBadge for reservation statuses.
 *
 * Preserves the existing visual: a neutral-outlined chip with a colored dot
 * indicating the status. Tones are mapped for semantic callers that need them,
 * but the rendered background stays neutral (muted) to match the current UI.
 */

import { cn } from "@/src/lib/utils/cn.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import type { ReservationStatus } from "@/src/db/schema.ts";

interface Props {
  status: ReservationStatus;
  className?: string;
  /** When true, renders the chip with a slightly larger footprint. */
  large?: boolean;
}

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  conflicted: "Conflicted",
  orphaned: "Orphaned",
};

const STATUS_DOT: Record<ReservationStatus, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-indigo-500",
  active: "bg-emerald-500",
  completed: "bg-muted-foreground/60",
  cancelled: "bg-muted-foreground/60",
  conflicted: "bg-rose-500",
  orphaned: "bg-sky-500",
};

export function ReservationStatusBadge(
  { status, className, large }: Props,
) {
  const label = STATUS_LABELS[status];
  return (
    <StatusBadge
      tone="muted"
      label={label}
      large={large}
      className={className}
      icon={<span class={cn("size-1.5 rounded-full", STATUS_DOT[status])} />}
    />
  );
}
