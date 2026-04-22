/**
 * ReservationStatusChip — small outlined badge with a leading dot.
 *
 * Status → tone mapping mirrors sibling's `StatusPillRow` tones so that when
 * these chips sit inside a pill row they don't clash visually.
 */

import { cn } from "@/src/lib/utils/cn.ts";
import type { ReservationStatus } from "@/src/db/schema.ts";

type Tone = "muted" | "amber" | "indigo" | "emerald" | "rose" | "sky";

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  conflicted: "Conflicted",
  orphaned: "Orphaned",
};

const STATUS_TONES: Record<ReservationStatus, Tone> = {
  pending: "amber",
  confirmed: "indigo",
  active: "emerald",
  completed: "muted",
  cancelled: "muted",
  conflicted: "rose",
  orphaned: "sky",
};

const toneDot: Record<Tone, string> = {
  muted: "bg-muted-foreground/60",
  amber: "bg-amber-500",
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
};

interface Props {
  status: ReservationStatus;
  class?: string;
  /** When true, renders the chip with a slightly larger footprint. */
  large?: boolean;
}

export function ReservationStatusChip(
  { status, class: className, large }: Props,
) {
  const tone = STATUS_TONES[status];
  const label = STATUS_LABELS[status];
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-background font-medium",
        large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        className,
      )}
      title={label}
    >
      <span
        aria-hidden="true"
        class={cn("size-1.5 rounded-full", toneDot[tone])}
      />
      <span>{label}</span>
    </span>
  );
}
