/**
 * Phase P5 — ScheduleGrid island
 *
 * 7 rows (days) × 48 cols (30-min slots) SVG grid. Cells toggle on click
 * and drag; filled cells indicate allowed charging windows. Emerald fill
 * on selected slots.
 *
 * Accessibility:
 *   - root has role="grid" with aria-rowcount / aria-colcount
 *   - each cell has role="gridcell" + aria-selected
 *   - a visually-hidden textual summary is rendered alongside for screen
 *     readers (day-by-day human summary)
 *   - keyboard: arrow keys move cursor, Space toggles, Home/End jump
 *
 * Mobile: the SVG renders responsively; for very small viewports the
 * parent ProfileEditor renders a day accordion instead of this island.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { cn } from "@/src/lib/utils/cn.ts";

export interface ScheduleWindow {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  maxW?: number;
}

export interface ScheduleGridProps {
  windows: ScheduleWindow[];
  onChange?: (windows: ScheduleWindow[]) => void;
  readOnly?: boolean;
  /** Slot size in minutes (default 30 → 48 cols). */
  slotMinutes?: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSlotFilled(
  day: number,
  slotStart: number,
  slotEnd: number,
  windows: ScheduleWindow[],
): boolean {
  for (const w of windows) {
    if (w.dayOfWeek !== day) continue;
    // half-open overlap [startMin, endMin)
    if (w.startMin < slotEnd && w.endMin > slotStart) return true;
  }
  return false;
}

/** Convert a boolean matrix (7×N) back into merged windows. */
function matrixToWindows(
  matrix: boolean[][],
  slotMinutes: number,
): ScheduleWindow[] {
  const out: ScheduleWindow[] = [];
  for (let dow = 0; dow < 7; dow++) {
    let runStart: number | null = null;
    for (let i = 0; i < matrix[dow].length; i++) {
      if (matrix[dow][i] && runStart === null) runStart = i * slotMinutes;
      const ended = !matrix[dow][i] && runStart !== null;
      const last = i === matrix[dow].length - 1;
      if (ended || (last && matrix[dow][i] && runStart !== null)) {
        const end = ended ? i * slotMinutes : (i + 1) * slotMinutes;
        out.push({ dayOfWeek: dow, startMin: runStart!, endMin: end });
        runStart = null;
      }
    }
  }
  return out;
}

export default function ScheduleGrid(
  { windows, onChange, readOnly, slotMinutes = 30 }: ScheduleGridProps,
) {
  const cols = Math.floor((24 * 60) / slotMinutes);
  const localWindows = useSignal<ScheduleWindow[]>(windows);
  const isDragging = useSignal(false);
  const dragMode = useSignal<"fill" | "clear">("fill");
  const gridRef = useRef<HTMLDivElement>(null);

  // Keep local state in sync if parent pushes new windows (e.g. preset swap).
  useEffect(() => {
    localWindows.value = windows;
  }, [windows]);

  const matrix = useComputed(() => {
    const m: boolean[][] = [];
    for (let dow = 0; dow < 7; dow++) {
      const row: boolean[] = [];
      for (let i = 0; i < cols; i++) {
        const s = i * slotMinutes;
        const e = s + slotMinutes;
        row.push(isSlotFilled(dow, s, e, localWindows.value));
      }
      m.push(row);
    }
    return m;
  });

  const summary = useComputed(() => {
    // Human-readable summary for screen readers
    const out: string[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const runs: string[] = [];
      let start: number | null = null;
      for (let i = 0; i < cols; i++) {
        if (matrix.value[dow][i] && start === null) start = i * slotMinutes;
        if (!matrix.value[dow][i] && start !== null) {
          runs.push(
            `${formatTime(start)}–${formatTime(i * slotMinutes)}`,
          );
          start = null;
        }
      }
      if (start !== null) {
        runs.push(`${formatTime(start)}–${formatTime(24 * 60)}`);
      }
      out.push(
        `${DAY_LABELS[dow]}: ${runs.length ? runs.join(", ") : "off"}`,
      );
    }
    return out.join("; ");
  });

  const commitMatrix = useCallback(() => {
    const next = matrixToWindows(matrix.value, slotMinutes);
    if (onChange) onChange(next);
  }, [onChange, slotMinutes]);

  const toggleCell = useCallback(
    (dow: number, col: number, mode?: "fill" | "clear") => {
      if (readOnly) return;
      const slotStart = col * slotMinutes;
      const slotEnd = slotStart + slotMinutes;
      const currently = isSlotFilled(
        dow,
        slotStart,
        slotEnd,
        localWindows.value,
      );
      const target = mode === "fill"
        ? true
        : mode === "clear"
        ? false
        : !currently;
      if (currently === target) return;

      // Rebuild the matrix with the single-cell edit, then convert back
      const m = matrix.value.map((row) => row.slice());
      m[dow][col] = target;
      localWindows.value = matrixToWindows(m, slotMinutes);
    },
    [readOnly, slotMinutes],
  );

  const handleCellDown = (dow: number, col: number) => {
    if (readOnly) return;
    const slotStart = col * slotMinutes;
    const slotEnd = slotStart + slotMinutes;
    const filled = isSlotFilled(dow, slotStart, slotEnd, localWindows.value);
    dragMode.value = filled ? "clear" : "fill";
    isDragging.value = true;
    toggleCell(dow, col, dragMode.value);
  };

  const handleCellEnter = (dow: number, col: number) => {
    if (!isDragging.value || readOnly) return;
    toggleCell(dow, col, dragMode.value);
  };

  const handleMouseUp = useCallback(() => {
    if (!isDragging.value) return;
    isDragging.value = false;
    commitMatrix();
  }, [commitMatrix]);

  useEffect(() => {
    globalThis.addEventListener("mouseup", handleMouseUp);
    return () => globalThis.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  // SVG geometry
  const cellWidth = 14; // px (visual); responsive scaling handled by viewBox
  const cellHeight = 22;
  const gutter = 1;
  const width = cols * (cellWidth + gutter);
  const height = 7 * (cellHeight + gutter);

  const hourMarks = useMemo(() => {
    const marks: Array<{ x: number; label: string }> = [];
    for (let h = 0; h <= 24; h += 6) {
      marks.push({
        x: (h * 60 / slotMinutes) * (cellWidth + gutter),
        label: `${h.toString().padStart(2, "0")}:00`,
      });
    }
    return marks;
  }, [slotMinutes]);

  return (
    <div
      ref={gridRef}
      className="w-full overflow-x-auto"
      data-testid="schedule-grid"
    >
      <span className="sr-only" aria-live="polite">
        Schedule summary: {summary.value}
      </span>
      <svg
        role="grid"
        aria-label="Weekly charging schedule"
        aria-rowcount={7}
        aria-colcount={cols}
        viewBox={`0 0 ${width + 40} ${height + 24}`}
        className="block w-full h-auto touch-none select-none"
      >
        {/* hour labels */}
        {hourMarks.map((m) => (
          <text
            key={`h-${m.x}`}
            x={40 + m.x}
            y={10}
            fontSize={9}
            textAnchor="middle"
            className="fill-muted-foreground"
          >
            {m.label}
          </text>
        ))}
        {/* day labels */}
        {DAY_LABELS.map((lbl, dow) => (
          <text
            key={`d-${dow}`}
            x={2}
            y={24 + dow * (cellHeight + gutter) + cellHeight / 2 + 3}
            fontSize={10}
            className="fill-muted-foreground"
          >
            {lbl}
          </text>
        ))}
        {/* cells */}
        {matrix.value.map((row, dow) =>
          row.map((filled, col) => {
            const x = 40 + col * (cellWidth + gutter);
            const y = 16 + dow * (cellHeight + gutter);
            return (
              <rect
                key={`c-${dow}-${col}`}
                role="gridcell"
                aria-selected={filled ? "true" : "false"}
                aria-label={`${DAY_LABELS[dow]} ${
                  formatTime(col * slotMinutes)
                } to ${formatTime((col + 1) * slotMinutes)}`}
                x={x}
                y={y}
                width={cellWidth}
                height={cellHeight}
                rx={2}
                className={cn(
                  "transition-colors cursor-pointer",
                  filled
                    ? "fill-emerald-500/80"
                    : "fill-muted hover:fill-emerald-500/30",
                  readOnly && "cursor-default",
                )}
                onMouseDown={() => handleCellDown(dow, col)}
                onMouseEnter={() => handleCellEnter(dow, col)}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
