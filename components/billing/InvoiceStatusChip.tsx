import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import type { InvoiceUiStatus } from "@/src/lib/invoice-ui.ts";

interface Props {
  status: InvoiceUiStatus;
  /**
   * When true render as an outlined chip (cross-surface reference).
   * When false render a filled chip (own-domain: the Invoices surface).
   */
  outlined?: boolean;
  className?: string;
}

/**
 * Chip for the derived invoice UI status.
 * Own-domain chips are filled, cross-domain chips (outlined) show only the
 * destination accent border per the accent allocation rule.
 */
export function InvoiceStatusChip(
  { status, outlined = false, className }: Props,
) {
  const label = STATUS_LABEL[status];
  const tone = STATUS_TONE[status];

  if (outlined) {
    return (
      <Badge
        variant="outline"
        className={cn(tone.outlined, "gap-1.5", className)}
      >
        <span
          className={cn("inline-block size-1.5 rounded-full", tone.dot)}
          aria-hidden="true"
        />
        {label}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn(tone.filled, "gap-1.5", className)}>
      <span
        className={cn("inline-block size-1.5 rounded-full", tone.dot)}
        aria-hidden="true"
      />
      {label}
    </Badge>
  );
}

const STATUS_LABEL: Record<InvoiceUiStatus, string> = {
  draft: "Draft",
  finalized: "Finalized",
  paid: "Paid",
  pending: "Pending",
  failed: "Failed",
  overdue: "Overdue",
  voided: "Voided",
};

const STATUS_TONE: Record<
  InvoiceUiStatus,
  { filled: string; outlined: string; dot: string }
> = {
  draft: {
    filled:
      "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
    outlined: "border-slate-500/40 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-500",
  },
  finalized: {
    filled:
      "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
    outlined: "border-teal-500/40 text-teal-700 dark:text-teal-300",
    dot: "bg-teal-500",
  },
  paid: {
    filled:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    outlined: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  pending: {
    filled:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    outlined: "border-amber-500/40 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  failed: {
    filled:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    outlined: "border-rose-500/40 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  overdue: {
    filled:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    outlined: "border-rose-500/40 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  voided: {
    filled:
      "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
    outlined: "border-zinc-500/40 text-zinc-700 dark:text-zinc-300",
    dot: "bg-zinc-500",
  },
};
