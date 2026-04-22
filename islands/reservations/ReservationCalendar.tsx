/**
 * ReservationCalendar — week view at `md+`, card-stack at `<md`.
 *
 * Each block is a `role="button"` with an accessible label describing the
 * full reservation (tag, charger, window, status). Arrow keys move the
 * selection between blocks; Enter navigates to the detail page.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
} from "lucide-preact";
import type { ReservationRowDTO } from "@/src/db/schema.ts";
import { ReservationStatusChip } from "@/components/reservations/ReservationStatusChip.tsx";
import { TimeRangePill } from "@/components/reservations/TimeRangePill.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  reservations: ReservationRowDTO[];
  /** Charger-local tz when every reservation shares one (best-effort). */
  displayTz?: string | null;
  /** Initial view mode. */
  defaultView?: "week" | "list";
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const weekday = copy.getDay(); // 0 = Sunday
  const offset = (weekday + 6) % 7; // Monday-start
  copy.setDate(copy.getDate() - offset);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function formatDay(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

export default function ReservationCalendar(
  { reservations, displayTz, defaultView = "week" }: Props,
) {
  const [view, setView] = useState<"week" | "list">(defaultView);
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date())
  );
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const blockRefs = useRef<Map<number, HTMLAnchorElement>>(new Map());

  // Respond to window-resize by ensuring focus stays reachable.
  useEffect(() => {
    if (focusedId === null) return;
    const el = blockRefs.current.get(focusedId);
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }, [focusedId]);

  const weekEnd = addDays(weekStart, 7);
  const visible = reservations
    .filter((r) => {
      const s = new Date(r.startAtIso).getTime();
      return s >= weekStart.getTime() && s < weekEnd.getTime();
    })
    .sort((a, b) =>
      new Date(a.startAtIso).getTime() - new Date(b.startAtIso).getTime()
    );

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const byDay: Record<string, ReservationRowDTO[]> = {};
  for (const day of days) {
    byDay[day.toDateString()] = [];
  }
  for (const r of visible) {
    const key = new Date(r.startAtIso).toDateString();
    (byDay[key] ??= []).push(r);
  }

  const moveFocus = (direction: -1 | 1) => {
    if (visible.length === 0) return;
    const currentIdx = focusedId === null
      ? 0
      : visible.findIndex((r) => r.id === focusedId);
    const safeIdx = currentIdx < 0 ? 0 : currentIdx;
    const nextIdx = (safeIdx + direction + visible.length) % visible.length;
    setFocusedId(visible[nextIdx].id);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft class="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight class="size-4" />
          </Button>
          <span class="text-sm text-muted-foreground">
            {formatDay(weekStart)} – {formatDay(addDays(weekEnd, -1))}
          </span>
        </div>

        <div class="flex items-center gap-1 rounded-md border p-0.5">
          <button
            type="button"
            class={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              view === "week"
                ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setView("week")}
            aria-pressed={view === "week"}
          >
            <CalendarDays class="size-3.5" /> Week
          </button>
          <button
            type="button"
            class={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              view === "list"
                ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
          >
            <ListOrdered class="size-3.5" /> List
          </button>
        </div>
      </div>

      {/* Empty state */}
      {visible.length === 0 && (
        <div class="rounded-md border border-dashed bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          No reservations this week.
        </div>
      )}

      {visible.length > 0 && view === "week" && (
        // Week view (md+): 7-column grid; below md: vertical day cards.
        <div
          class="grid gap-3 md:grid-cols-7"
          onKeyDown={handleKeyDown}
          role="grid"
          aria-label="Reservations week view"
        >
          {days.map((d) => {
            const key = d.toDateString();
            const isToday = key === new Date().toDateString();
            return (
              <div
                key={key}
                role="row"
                class={cn(
                  "rounded-md border bg-background p-2 min-h-[120px]",
                  isToday && "border-indigo-500/50",
                )}
              >
                <div
                  class={cn(
                    "mb-2 text-xs font-semibold uppercase tracking-wide",
                    isToday
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-muted-foreground",
                  )}
                >
                  {formatDay(d)}
                </div>
                <ul class="flex flex-col gap-1.5">
                  {(byDay[key] ?? []).map((r) => (
                    <CalendarBlock
                      key={r.id}
                      r={r}
                      displayTz={displayTz ?? undefined}
                      focused={focusedId === r.id}
                      onFocus={() => setFocusedId(r.id)}
                      registerRef={(el) => {
                        if (el) blockRefs.current.set(r.id, el);
                        else blockRefs.current.delete(r.id);
                      }}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {visible.length > 0 && view === "list" && (
        <ul class="flex flex-col gap-2" onKeyDown={handleKeyDown}>
          {visible.map((r) => (
            <CalendarBlock
              key={r.id}
              r={r}
              displayTz={displayTz ?? undefined}
              focused={focusedId === r.id}
              onFocus={() => setFocusedId(r.id)}
              registerRef={(el) => {
                if (el) {
                  blockRefs.current.set(r.id, el);
                } else blockRefs.current.delete(r.id);
              }}
              fullWidth
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface BlockProps {
  r: ReservationRowDTO;
  displayTz?: string;
  focused: boolean;
  onFocus: () => void;
  registerRef: (el: HTMLAnchorElement | null) => void;
  fullWidth?: boolean;
}

function CalendarBlock(
  { r, displayTz, focused, onFocus, registerRef, fullWidth }: BlockProps,
) {
  const aria = `${r.steveOcppIdTag} at ${r.chargeBoxId}, ${
    new Date(r.startAtIso).toLocaleString()
  } – ${new Date(r.endAtIso).toLocaleString()}, ${r.status}`;

  return (
    <li>
      <a
        ref={registerRef}
        href={`/reservations/${r.id}`}
        role="button"
        aria-label={aria}
        tabIndex={focused ? 0 : -1}
        onFocus={onFocus}
        class={cn(
          "group block rounded-md border bg-indigo-500/5 px-2 py-1.5 text-xs transition-colors hover:bg-indigo-500/10 focus:outline-none focus:ring-2 focus:ring-indigo-500/50",
          fullWidth ? "flex items-center justify-between gap-3" : "",
        )}
      >
        <div class={cn("flex flex-col gap-1", fullWidth && "flex-1")}>
          <div class="flex items-center justify-between gap-2">
            <span class="truncate font-mono text-[11px]">
              {r.steveOcppIdTag}
            </span>
            <ReservationStatusChip status={r.status} />
          </div>
          <div class="flex items-center gap-1.5 text-muted-foreground">
            <TimeRangePill
              startAtIso={r.startAtIso}
              endAtIso={r.endAtIso}
              tz={displayTz}
              compact
            />
          </div>
          <div class="truncate text-[11px] text-muted-foreground">
            {r.chargeBoxId} · connector {r.connectorId || "any"}
          </div>
        </div>
      </a>
    </li>
  );
}
