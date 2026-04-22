import { Badge } from "@/components/ui/badge.tsx";
import { AlertCircle, CheckCircle2, Clock, SkipForward } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

export type WebhookStatus =
  | "pending"
  | "processed"
  | "failed"
  | "skipped"; // circuit-breaker-open rows

interface WebhookStatusBadgeProps {
  status: WebhookStatus;
  className?: string;
}

/**
 * Derives `status` from a lago_webhook_events row:
 *   processedAt === null                  → pending
 *   processingError === 'circuit_breaker_open' → skipped
 *   processingError !== null              → failed
 *   processedAt !== null, no error        → processed
 *
 * Status is NEVER color-only — we ship an icon and readable label per row.
 */
export function WebhookStatusBadge(
  { status, className }: WebhookStatusBadgeProps,
) {
  const styles: Record<
    WebhookStatus,
    { icon: typeof Clock; label: string; cls: string }
  > = {
    pending: {
      icon: Clock,
      label: "Pending",
      cls:
        "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    },
    processed: {
      icon: CheckCircle2,
      label: "Processed",
      cls:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    failed: {
      icon: AlertCircle,
      label: "Failed",
      cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
    skipped: {
      icon: SkipForward,
      label: "Skipped (breaker open)",
      cls:
        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
  };

  const { icon: Icon, label, cls } = styles[status];

  return (
    <Badge variant="outline" className={cn(cls, className)}>
      <Icon className="size-3" aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}

/**
 * Helper: derives the badge status from the raw row fields. Kept here so any
 * call site can just drop in a row + render the badge.
 */
export function deriveWebhookStatus(row: {
  processedAt: Date | string | null | undefined;
  processingError: string | null | undefined;
}): WebhookStatus {
  if (row.processedAt === null || row.processedAt === undefined) {
    return "pending";
  }
  if (row.processingError === "circuit_breaker_open") return "skipped";
  if (row.processingError) return "failed";
  return "processed";
}
