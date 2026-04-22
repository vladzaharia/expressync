/**
 * TimeRangePill — compact display of a reservation window.
 *
 * Accepts ISO strings + optional timezone. When `tz` is provided, times are
 * rendered in that IANA zone (e.g. the charger-local tz); otherwise they fall
 * back to the browser's zone and the element flags the ambiguity via `title`.
 */

import { cn } from "@/src/lib/utils/cn.ts";
import { Clock } from "lucide-preact";

interface Props {
  startAtIso: string;
  endAtIso: string;
  /** Optional IANA timezone. If unset, uses the viewer's local zone. */
  tz?: string | null;
  class?: string;
  /** When true, renders only `HH:mm – HH:mm` (no date prefix). */
  compact?: boolean;
}

function formatPart(iso: string, tz?: string | null, withDate = true): string {
  const d = new Date(iso);
  const fmtOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (withDate) {
    fmtOpts.month = "short";
    fmtOpts.day = "numeric";
  }
  if (tz) fmtOpts.timeZone = tz;
  try {
    return new Intl.DateTimeFormat(undefined, fmtOpts).format(d);
  } catch {
    // Invalid tz — fall back to local.
    return new Intl.DateTimeFormat(undefined, {
      ...fmtOpts,
      timeZone: undefined,
    }).format(d);
  }
}

export function TimeRangePill(
  { startAtIso, endAtIso, tz, class: className, compact }: Props,
) {
  const sameDay = (() => {
    const s = new Date(startAtIso);
    const e = new Date(endAtIso);
    return s.toDateString() === e.toDateString();
  })();

  const tzSuffix = tz ?? "local";

  const start = formatPart(startAtIso, tz, !compact);
  const end = formatPart(
    endAtIso,
    tz,
    !compact && !sameDay,
  );

  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
      title={`Shown in ${tzSuffix} timezone`}
    >
      <Clock aria-hidden="true" class="size-3.5 text-muted-foreground" />
      <span>
        {start} <span class="text-muted-foreground">–</span> {end}
      </span>
      {!tz && (
        <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
          local
        </span>
      )}
    </span>
  );
}
