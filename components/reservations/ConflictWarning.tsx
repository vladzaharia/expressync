/**
 * ConflictWarning — inline conflict notice for the wizard's time step.
 *
 * Rendered when `checkConflicts` returns blocking overlaps. Lists each
 * conflict with its tag + window. Includes a dismissible "Suggest next free"
 * affordance when `onPickSuggestion` is provided.
 */

import { AlertTriangle } from "lucide-preact";
import { TimeRangePill } from "./TimeRangePill.tsx";
import { ReservationStatusChip } from "./ReservationStatusChip.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import type { ReservationStatus } from "@/src/db/schema.ts";

interface ConflictItem {
  id: number;
  startAtIso: string;
  endAtIso: string;
  status: ReservationStatus;
  steveOcppIdTag: string;
}

interface Props {
  conflicts: ConflictItem[];
  /** Optional IANA tz for display. */
  tz?: string | null;
  /**
   * Optional callback invoked with a suggested start ISO that avoids the
   * last conflict in the list (current end + 15 min buffer).
   */
  onPickSuggestion?: (startAtIso: string) => void;
  class?: string;
}

export function ConflictWarning(
  { conflicts, tz, onPickSuggestion, class: className }: Props,
) {
  if (conflicts.length === 0) return null;

  const suggestion = (() => {
    const maxEnd = conflicts
      .map((c) => new Date(c.endAtIso).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    if (!Number.isFinite(maxEnd) || maxEnd === 0) return null;
    // Add a 15-minute buffer so the user has a clear gap.
    return new Date(maxEnd + 15 * 60_000).toISOString();
  })();

  return (
    <div
      role="alert"
      class={cn(
        "rounded-md border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm",
        className,
      )}
    >
      <div class="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          class="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400"
        />
        <div class="flex-1">
          <p class="font-medium text-rose-700 dark:text-rose-300">
            {conflicts.length === 1
              ? "Time window overlaps with an existing reservation"
              : `Time window overlaps with ${conflicts.length} existing reservations`}
          </p>
          <ul class="mt-2 space-y-2">
            {conflicts.map((c) => (
              <li key={c.id} class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs">{c.steveOcppIdTag}</span>
                <TimeRangePill
                  startAtIso={c.startAtIso}
                  endAtIso={c.endAtIso}
                  tz={tz ?? undefined}
                  compact
                />
                <ReservationStatusChip status={c.status} />
              </li>
            ))}
          </ul>
          {suggestion && onPickSuggestion && (
            <button
              type="button"
              class="mt-3 inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-background px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
              onClick={() => onPickSuggestion(suggestion)}
            >
              Try after last conflict
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
