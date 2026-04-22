/**
 * TransactionStatusBadge — wraps StatusBadge for transaction statuses.
 *
 *   pending     → warning + Clock
 *   in_progress → warning + Clock (same "in-flight" tone)
 *   completed   → success + CheckCircle2
 *   failed      → destructive + AlertCircle
 */

import { AlertCircle, CheckCircle2, Clock } from "lucide-preact";
import { StatusBadge, type StatusBadgeTone } from "./StatusBadge.tsx";

export type TransactionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "in_progress";

interface Props {
  status: TransactionStatus;
  large?: boolean;
  className?: string;
}

const ICON_CLASS = "size-3";

const MAP: Record<
  TransactionStatus,
  { tone: StatusBadgeTone; label: string; icon: preact.JSX.Element }
> = {
  pending: {
    tone: "warning",
    label: "Pending",
    icon: <Clock class={ICON_CLASS} />,
  },
  in_progress: {
    tone: "warning",
    label: "In Progress",
    icon: <Clock class={ICON_CLASS} />,
  },
  completed: {
    tone: "success",
    label: "Complete",
    icon: <CheckCircle2 class={ICON_CLASS} />,
  },
  failed: {
    tone: "destructive",
    label: "Failed",
    icon: <AlertCircle class={ICON_CLASS} />,
  },
};

export function TransactionStatusBadge(
  { status, large, className }: Props,
) {
  const { tone, label, icon } = MAP[status];
  return (
    <StatusBadge
      tone={tone}
      icon={icon}
      label={label}
      large={large}
      className={className}
    />
  );
}
