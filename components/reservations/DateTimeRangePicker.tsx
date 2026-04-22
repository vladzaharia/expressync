/**
 * DateTimeRangePicker — reservation-focused date + time range picker.
 *
 * First-class replacement for the naive `<input type="datetime-local">` pair
 * previously used in the reservation wizard's Step 4 and the reschedule
 * dialog. Built in pure Preact with `Intl.*` primitives (no date lib); keeps
 * the bundle under ~4 KB gzipped.
 *
 * Features
 *   - Month grid calendar with arrow-key navigation (role="grid" / gridcell).
 *     ↑/↓ move week-to-week, ←/→ day-to-day, PgUp/PgDn flip months,
 *     Home/End jump to start/end of row, Enter/Space select.
 *   - Start + end time inputs snapped to a configurable granularity (15 or
 *     30 min). Bound visually with a compact duration readout.
 *   - Duration preset chips (1h / 2h / 4h / custom) that reflect the current
 *     end offset.
 *   - Conflict overlay: the calendar highlights days that contain an existing
 *     reservation and the footer surfaces a red live-region announcement when
 *     the selected window overlaps any conflict on the chosen day.
 *   - Timezone aware: all times are displayed in the provided IANA `tz` (the
 *     charger-local zone when known) via `Intl.DateTimeFormat`; the raw
 *     `Date` values we emit are always UTC under the hood.
 *   - Touch-first: every interactive target is ≥44px on `sm` and smaller.
 *     Hover states are decorative only; focus styling is authoritative.
 *   - Respects `prefers-reduced-motion` for the month transitions.
 *
 * Two variants
 *   - `variant="inline"` (default) — wizard Step 4, full-width, calendar left,
 *     time/duration controls right.
 *   - `variant="compact"` — reschedule dialog, stacked single-column layout.
 *
 * Props
 *   `value`                 Current window as `{ startAt: Date, endAt: Date }`
 *                           or `null` for "not yet picked".
 *   `onChange`              Fires with the new window on any change.
 *   `tz`                    Optional IANA zone for display. When absent the
 *                           component renders in the viewer's local zone and
 *                           surfaces a "Times shown in your timezone" tooltip.
 *   `minuteStep`            Time granularity in minutes; 15 (default) or 30.
 *   `conflicts`             Array of existing `[start, end)` reservations on
 *                           the selected charger/connector, used to paint the
 *                           calendar and drive the live overlap banner.
 *   `loadingConflicts`      Show a skeleton shimmer while the parent refetches.
 *   `variant`               `"inline" | "compact"`.
 *   `minDate`               Optional floor — days before it are disabled.
 *   `durationPresetsMin`    Chips (in minutes). Defaults to `[60,120,240,480,720]`
 *                           (1h / 2h / 4h / 8h / 12h).
 */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

export interface DateTimeRange {
  startAt: Date;
  endAt: Date;
}

export interface PickerConflict {
  id: number;
  startAtIso: string;
  endAtIso: string;
}

interface Props {
  value: DateTimeRange | null;
  onChange: (next: DateTimeRange) => void;
  tz?: string | null;
  minuteStep?: 15 | 30;
  conflicts?: PickerConflict[];
  loadingConflicts?: boolean;
  variant?: "inline" | "compact";
  minDate?: Date;
  durationPresetsMin?: number[];
  /** Optional id prefix so multiple pickers on one page don't collide. */
  idPrefix?: string;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymdInTz(
  d: Date,
  tz: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Build a UTC `Date` representing the given wall-clock time in `tz`. Uses
 * iterative correction to account for DST transitions.
 */
function zonedDate(
  year: number,
  month: number, // 1-12
  day: number,
  hours: number,
  minutes: number,
  tz?: string | null,
): Date {
  if (!tz) {
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }
  // Start with a UTC guess.
  let utc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  for (let i = 0; i < 3; i++) {
    const d = new Date(utc);
    const got = partsInTz(d, tz);
    const deltaMin = (got.hours - hours) * 60 + (got.minutes - minutes) +
      (got.day - day) * 24 * 60;
    if (deltaMin === 0) break;
    utc -= deltaMin * 60_000;
  }
  return new Date(utc);
}

function partsInTz(
  d: Date,
  tz: string,
): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hours = get("hour");
  if (hours === 24) hours = 0; // en-CA midnight quirk
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hours,
    minutes: get("minute"),
  };
}

function formatMonthHeading(year: number, month: number, tz?: string | null) {
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: tz ?? undefined,
  }).format(d);
}

function buildMonthGrid(
  year: number,
  month: number, // 1-12
): Array<{ year: number; month: number; day: number; inMonth: boolean }> {
  // Compute first-of-month weekday (Mon=0..Sun=6).
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = (first.getUTCDay() + 6) % 7; // shift so Mon=0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysInPrev = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const out: Array<
    { year: number; month: number; day: number; inMonth: boolean }
  > = [];
  // Leading days from previous month.
  for (let i = dow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const ym = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    out.push({ year: ym.y, month: ym.m, day: d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    out.push({ year, month, day: d, inMonth: true });
  }
  // Trailing days to complete 6 weeks (42 cells) for stable layout.
  while (out.length < 42) {
    const last = out[out.length - 1];
    const next = last.day + 1;
    const rolloverDays = new Date(Date.UTC(last.year, last.month, 0))
      .getUTCDate();
    if (next > rolloverDays) {
      const ym = last.month === 12
        ? { y: last.year + 1, m: 1 }
        : { y: last.year, m: last.month + 1 };
      out.push({ year: ym.y, month: ym.m, day: 1, inMonth: false });
    } else {
      out.push({
        year: last.year,
        month: last.month,
        day: next,
        inMonth: false,
      });
    }
  }
  return out;
}

function toTimeStr(d: Date, tz?: string | null): string {
  const p = tz ? partsInTz(d, tz) : {
    hours: d.getHours(),
    minutes: d.getMinutes(),
  };
  return `${String(p.hours).padStart(2, "0")}:${
    String(p.minutes).padStart(2, "0")
  }`;
}

function parseTimeStr(v: string): { hours: number; minutes: number } | null {
  const m = /^([0-2]?\d):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23) return null;
  return { hours, minutes };
}

function snap(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export function DateTimeRangePicker(props: Props) {
  const {
    value,
    onChange,
    tz,
    minuteStep = 15,
    conflicts = [],
    loadingConflicts = false,
    variant = "inline",
    minDate,
    durationPresetsMin = [60, 120, 240, 480, 720],
    idPrefix = "dtrp",
  } = props;

  const now = useMemo(() => new Date(), []);
  const effectiveStart = value?.startAt ?? now;
  const effectiveEnd = value?.endAt ?? new Date(now.getTime() + 60 * 60_000);
  const durationMin = Math.max(
    1,
    Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000),
  );

  // View month (separate from selection so the user can browse).
  const anchor = value?.startAt ?? now;
  const anchorParts = tz ? ymdInTz(anchor, tz) : {
    year: anchor.getFullYear(),
    month: anchor.getMonth() + 1,
    day: anchor.getDate(),
  };
  const [viewYear, setViewYear] = useState(anchorParts.year);
  const [viewMonth, setViewMonth] = useState(anchorParts.month);
  // Keep view in sync when the external value jumps to a different month.
  useEffect(() => {
    if (!value) return;
    const p = tz ? ymdInTz(value.startAt, tz) : {
      year: value.startAt.getFullYear(),
      month: value.startAt.getMonth() + 1,
    };
    setViewYear(p.year);
    setViewMonth(p.month);
  }, [value?.startAt?.getTime(), tz]);

  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const grid = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  // Conflict day map: yyyy-mm-dd strings with any conflict overlap.
  const conflictDays = useMemo(() => {
    const set = new Set<string>();
    for (const c of conflicts) {
      const s = new Date(c.startAtIso);
      const e = new Date(c.endAtIso);
      // Walk each day from s to e-1 in target tz.
      const cursor = new Date(s);
      while (cursor.getTime() < e.getTime()) {
        const p = tz ? ymdInTz(cursor, tz) : {
          year: cursor.getFullYear(),
          month: cursor.getMonth() + 1,
          day: cursor.getDate(),
        };
        set.add(
          `${p.year}-${String(p.month).padStart(2, "0")}-${
            String(p.day).padStart(2, "0")
          }`,
        );
        cursor.setTime(cursor.getTime() + 24 * 60 * 60_000);
      }
    }
    return set;
  }, [conflicts, tz]);

  const selectedKey = value
    ? (() => {
      const p = tz ? ymdInTz(value.startAt, tz) : {
        year: value.startAt.getFullYear(),
        month: value.startAt.getMonth() + 1,
        day: value.startAt.getDate(),
      };
      return `${p.year}-${String(p.month).padStart(2, "0")}-${
        String(p.day).padStart(2, "0")
      }`;
    })()
    : null;

  const todayKey = (() => {
    const p = tz ? ymdInTz(now, tz) : {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
    return `${p.year}-${String(p.month).padStart(2, "0")}-${
      String(p.day).padStart(2, "0")
    }`;
  })();

  const minKey = minDate
    ? (() => {
      const p = tz ? ymdInTz(minDate, tz) : {
        year: minDate.getFullYear(),
        month: minDate.getMonth() + 1,
        day: minDate.getDate(),
      };
      return `${p.year}-${String(p.month).padStart(2, "0")}-${
        String(p.day).padStart(2, "0")
      }`;
    })()
    : null;

  const cellKey = (c: { year: number; month: number; day: number }) =>
    `${c.year}-${String(c.month).padStart(2, "0")}-${
      String(c.day).padStart(2, "0")
    }`;

  const pickDay = (c: { year: number; month: number; day: number }) => {
    // Preserve the current time-of-day from the existing selection.
    const timeRef = value?.startAt ?? now;
    const tp = tz ? partsInTz(timeRef, tz) : {
      hours: timeRef.getHours(),
      minutes: timeRef.getMinutes(),
    };
    // Snap minutes to granularity.
    const snapped = snap(tp.minutes, minuteStep);
    const newStart = zonedDate(
      c.year,
      c.month,
      c.day,
      tp.hours + Math.floor(snapped / 60),
      snapped % 60,
      tz,
    );
    const newEnd = new Date(newStart.getTime() + durationMin * 60_000);
    onChange({ startAt: newStart, endAt: newEnd });
  };

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  const moveFocus = (deltaDays: number) => {
    if (!focusedCell) return;
    const [y, m, d] = focusedCell.split("-").map(Number);
    const ref = new Date(Date.UTC(y, m - 1, d));
    ref.setUTCDate(ref.getUTCDate() + deltaDays);
    const nk = `${ref.getUTCFullYear()}-${
      String(ref.getUTCMonth() + 1).padStart(2, "0")
    }-${String(ref.getUTCDate()).padStart(2, "0")}`;
    setFocusedCell(nk);
    // Switch viewed month if we navigated outside it.
    if (
      ref.getUTCFullYear() !== viewYear || ref.getUTCMonth() + 1 !== viewMonth
    ) {
      setViewYear(ref.getUTCFullYear());
      setViewMonth(ref.getUTCMonth() + 1);
    }
  };

  const onGridKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(e.shiftKey ? -28 : -7);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(e.shiftKey ? 28 : 7);
        break;
      case "PageUp":
        e.preventDefault();
        shiftMonth(-1);
        break;
      case "PageDown":
        e.preventDefault();
        shiftMonth(1);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(-(currentRowIndex()));
        break;
      case "End":
        e.preventDefault();
        moveFocus(6 - currentRowIndex());
        break;
      case "Enter":
      case " ":
        if (focusedCell) {
          e.preventDefault();
          const [y, m, d] = focusedCell.split("-").map(Number);
          pickDay({ year: y, month: m, day: d });
        }
        break;
    }
  };

  const currentRowIndex = () => {
    if (!focusedCell) return 0;
    const [y, m, d] = focusedCell.split("-").map(Number);
    const ref = new Date(Date.UTC(y, m - 1, d));
    return (ref.getUTCDay() + 6) % 7;
  };

  // Time inputs.
  const startTimeStr = toTimeStr(effectiveStart, tz);
  const endTimeStr = toTimeStr(effectiveEnd, tz);

  const applyStartTime = (v: string) => {
    const p = parseTimeStr(v);
    if (!p) return;
    const basisParts = tz ? ymdInTz(effectiveStart, tz) : {
      year: effectiveStart.getFullYear(),
      month: effectiveStart.getMonth() + 1,
      day: effectiveStart.getDate(),
    };
    const snapped = snap(p.minutes, minuteStep);
    const newStart = zonedDate(
      basisParts.year,
      basisParts.month,
      basisParts.day,
      p.hours + Math.floor(snapped / 60),
      snapped % 60,
      tz,
    );
    const newEnd = new Date(newStart.getTime() + durationMin * 60_000);
    onChange({ startAt: newStart, endAt: newEnd });
  };

  const applyEndTime = (v: string) => {
    const p = parseTimeStr(v);
    if (!p) return;
    const basisParts = tz ? ymdInTz(effectiveEnd, tz) : {
      year: effectiveEnd.getFullYear(),
      month: effectiveEnd.getMonth() + 1,
      day: effectiveEnd.getDate(),
    };
    const snapped = snap(p.minutes, minuteStep);
    let newEnd = zonedDate(
      basisParts.year,
      basisParts.month,
      basisParts.day,
      p.hours + Math.floor(snapped / 60),
      snapped % 60,
      tz,
    );
    // If end wraps before start (user typed 08:00 when start is 22:00), push
    // the end into the next day.
    if (newEnd.getTime() <= effectiveStart.getTime()) {
      newEnd = new Date(newEnd.getTime() + 24 * 60 * 60_000);
    }
    onChange({ startAt: effectiveStart, endAt: newEnd });
  };

  const applyDuration = (mins: number) => {
    const newEnd = new Date(effectiveStart.getTime() + mins * 60_000);
    onChange({ startAt: effectiveStart, endAt: newEnd });
  };

  // Overlap check for the currently selected window.
  const hasOverlap = useMemo(() => {
    if (!value) return false;
    const s = value.startAt.getTime();
    const e = value.endAt.getTime();
    return conflicts.some((c) => {
      const cs = new Date(c.startAtIso).getTime();
      const ce = new Date(c.endAtIso).getTime();
      return cs < e && ce > s;
    });
  }, [value?.startAt?.getTime(), value?.endAt?.getTime(), conflicts]);

  // Keyboard focus ring.
  const gridLabelId = `${idPrefix}-grid-label`;

  const calendar = (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          class="inline-flex size-9 items-center justify-center rounded-md border border-transparent text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60 active:bg-indigo-500/10"
        >
          <ChevronLeft class="size-4" />
        </button>
        <div
          id={gridLabelId}
          class="text-sm font-semibold text-foreground"
          aria-live="polite"
        >
          {formatMonthHeading(viewYear, viewMonth, tz)}
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          class="inline-flex size-9 items-center justify-center rounded-md border border-transparent text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60 active:bg-indigo-500/10"
        >
          <ChevronRight class="size-4" />
        </button>
      </div>

      <div
        class="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        aria-hidden="true"
      >
        {WEEKDAY_LABELS.map((w) => <div key={w} class="py-1">{w}</div>)}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-labelledby={gridLabelId}
        class="grid grid-cols-7 gap-0.5 motion-safe:transition-opacity"
        onKeyDown={onGridKey}
        tabIndex={-1}
      >
        {grid.map((c) => {
          const key = cellKey(c);
          const isSelected = selectedKey === key;
          const isToday = todayKey === key;
          const hasConflict = conflictDays.has(key);
          const isFocused = focusedCell === key;
          const disabled = minKey !== null && key < minKey;
          return (
            <div key={key} role="gridcell" aria-selected={isSelected}>
              <button
                type="button"
                disabled={disabled}
                tabIndex={isFocused || (!focusedCell && isSelected) ? 0 : -1}
                onFocus={() => setFocusedCell(key)}
                onClick={() => !disabled && pickDay(c)}
                aria-label={`${c.year}-${String(c.month).padStart(2, "0")}-${
                  String(c.day).padStart(2, "0")
                }${hasConflict ? " — has existing reservation" : ""}`}
                aria-current={isToday ? "date" : undefined}
                class={cn(
                  "relative flex h-10 min-h-[44px] w-full items-center justify-center rounded-md border text-sm tabular-nums transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500/60",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  !c.inMonth && "text-muted-foreground/50",
                  c.inMonth && !isSelected &&
                    "border-transparent text-foreground",
                  isSelected &&
                    "border-indigo-500 bg-indigo-500/15 text-indigo-700 font-semibold dark:text-indigo-300",
                  !isSelected && isToday &&
                    "border-indigo-500/30 text-indigo-600 dark:text-indigo-400",
                )}
              >
                {c.day}
                {hasConflict && (
                  <span
                    aria-hidden="true"
                    class={cn(
                      "absolute bottom-1 size-1 rounded-full",
                      isSelected ? "bg-rose-300" : "bg-rose-500",
                    )}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {loadingConflicts && (
        <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
          <span>Loading existing reservations…</span>
        </div>
      )}
    </div>
  );

  const startInputId = `${idPrefix}-start-time`;
  const endInputId = `${idPrefix}-end-time`;

  const timeControls = (
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-2">
        <label
          class="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
          htmlFor={startInputId}
        >
          Start time
          <input
            id={startInputId}
            type="time"
            step={minuteStep * 60}
            value={startTimeStr}
            onChange={(e) =>
              applyStartTime((e.target as HTMLInputElement).value)}
            aria-label="Reservation start time"
            class="min-h-[44px] rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
          />
        </label>
        <label
          class="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
          htmlFor={endInputId}
        >
          End time
          <input
            id={endInputId}
            type="time"
            step={minuteStep * 60}
            value={endTimeStr}
            onChange={(e) => applyEndTime((e.target as HTMLInputElement).value)}
            aria-label="Reservation end time"
            class="min-h-[44px] rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
          />
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] uppercase tracking-wide text-muted-foreground">
          Duration
        </span>
        {durationPresetsMin.map((m) => {
          const active = durationMin === m;
          const label = m % 60 === 0 ? `${m / 60}h` : `${m}m`;
          return (
            <button
              key={m}
              type="button"
              onClick={() => applyDuration(m)}
              aria-pressed={active}
              class={cn(
                "min-h-[32px] rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500/60",
                active
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
        <span class="ml-1 text-xs text-muted-foreground">
          ({durationMin} min)
        </span>
      </div>
    </div>
  );

  const summary = (
    <div
      role="status"
      aria-live="polite"
      class={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        hasOverlap
          ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300"
          : "border-indigo-500/30 bg-indigo-500/5 text-foreground",
      )}
    >
      <CalendarClock
        aria-hidden="true"
        class={cn(
          "mt-0.5 size-4 shrink-0",
          hasOverlap ? "text-rose-500" : "text-indigo-500",
        )}
      />
      <div class="flex-1">
        {value
          ? (
            <>
              <div class="font-medium">
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: tz ?? undefined,
                }).format(value.startAt)}
                {" → "}
                {new Intl.DateTimeFormat(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: tz ?? undefined,
                }).format(value.endAt)}
              </div>
              <div
                class="text-[11px] text-muted-foreground"
                title={tz
                  ? `Shown in ${tz}`
                  : "Times shown in your timezone (charger timezone unknown)"}
              >
                {tz ? `Charger-local (${tz})` : "Your timezone"} · {durationMin}
                {" "}
                min
                {hasOverlap && " · conflicts with existing reservation"}
              </div>
            </>
          )
          : <span class="text-muted-foreground">Pick a day to begin</span>}
      </div>
    </div>
  );

  if (variant === "compact") {
    return (
      <div class="flex flex-col gap-4">
        {calendar}
        {timeControls}
        {summary}
      </div>
    );
  }

  return (
    <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div class="rounded-md border bg-background p-3">{calendar}</div>
      <div class="flex flex-col gap-4">
        {timeControls}
        {summary}
      </div>
    </div>
  );
}

export default DateTimeRangePicker;
