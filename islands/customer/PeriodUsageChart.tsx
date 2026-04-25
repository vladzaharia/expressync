/**
 * PeriodUsageChart — inline SVG line chart of kWh per day for the current
 * billing period (or per-day for the whole year when the Year scope is
 * selected).
 *
 * Renders without any external charting deps. Picks a nice y-axis max,
 * draws gridlines at quarter intervals, and shades the area under the
 * line. Empty state renders a faded placeholder with "No usage yet".
 */

import type { AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface UsageDayPoint {
  /** ISO date string (yyyy-mm-dd) — midnight local of the day. */
  date: string;
  /** Total kWh sent to Lago on that day. */
  kwh: number;
}

interface Props {
  points: UsageDayPoint[];
  periodLabel: string;
  accent?: AccentColor;
  className?: string;
  /**
   * When true, renders the period total as a large emerald number — used on
   * the billing page where the headline usage figure is the primary readout.
   * Dashboard leaves this false for a quieter treatment.
   */
  emphasizeTotal?: boolean;
}

// Inline 2-space palette rather than pulling tailwind classes at runtime
// (inline <svg> can't consume Tailwind text-color via currentColor without
// ceding tone control). We render stroke/fill in the page accent by
// leaning on currentColor and a class on the wrapping <svg>.
const ACCENT_CLASS: Record<AccentColor, string> = {
  red: "text-red-500",
  orange: "text-orange-500",
  amber: "text-amber-500",
  yellow: "text-yellow-500",
  lime: "text-lime-500",
  green: "text-green-500",
  emerald: "text-emerald-500",
  teal: "text-teal-500",
  cyan: "text-cyan-500",
  sky: "text-sky-500",
  blue: "text-blue-500",
  indigo: "text-indigo-500",
  violet: "text-violet-500",
  purple: "text-purple-500",
  fuchsia: "text-fuchsia-500",
  pink: "text-pink-500",
  rose: "text-rose-500",
  slate: "text-slate-500",
};

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  if (n <= 1) return 1 * pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

export default function PeriodUsageChart(
  {
    points,
    periodLabel,
    accent = "blue",
    className,
    emphasizeTotal = false,
  }: Props,
) {
  const W = 640;
  const H = 220;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;

  const hasAny = points.some((p) => p.kwh > 0);
  const rawMax = Math.max(1, ...points.map((p) => p.kwh));
  const yMax = niceCeil(rawMax);
  const yTicks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax];

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = points.length;
  const dx = n > 1 ? innerW / (n - 1) : innerW;

  const px = (i: number) => padL + (n > 1 ? i * dx : innerW / 2);
  const py = (v: number) => padT + innerH - (v / yMax) * innerH;

  const linePath = n === 0 ? "" : points
    .map((p, i) =>
      `${i === 0 ? "M" : "L"} ${px(i).toFixed(2)} ${py(p.kwh).toFixed(2)}`
    )
    .join(" ");

  const areaPath = n === 0
    ? ""
    : `${linePath} L ${px(n - 1).toFixed(2)} ${(padT + innerH).toFixed(2)} L ${
      px(0).toFixed(2)
    } ${(padT + innerH).toFixed(2)} Z`;

  // Only label a few x ticks; otherwise the labels collide on wide periods.
  const maxLabels = 6;
  const labelEvery = n <= maxLabels ? 1 : Math.ceil(n / maxLabels);

  const total = points.reduce((sum, p) => sum + p.kwh, 0);
  const peakDay = points.reduce(
    (acc, p) => (p.kwh > acc.kwh ? p : acc),
    { date: "", kwh: 0 } as UsageDayPoint,
  );

  return (
    <div class={cn("flex h-full min-h-[220px] flex-col", className)}>
      <div class="mb-2 flex items-baseline justify-between gap-3">
        {emphasizeTotal
          ? (
            <p class="text-4xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              <span class="ml-2 text-sm font-normal text-muted-foreground">
                kWh
              </span>
            </p>
          )
          : (
            <p class="text-2xl font-semibold tabular-nums">
              {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              {" "}
              <span class="text-sm font-normal text-muted-foreground">
                kWh
              </span>
            </p>
          )}
        {peakDay.kwh > 0 && (
          <p class="text-[11px] text-muted-foreground">
            Peak day:{" "}
            <span class="text-foreground tabular-nums">
              {peakDay.kwh.toFixed(1)} kWh
            </span>{" "}
            · {formatDayLabel(peakDay.date)}
          </p>
        )}
      </div>

      <div class="relative flex-1 min-h-0 overflow-hidden rounded-md border bg-muted/20">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          class={cn("block h-full w-full", ACCENT_CLASS[accent])}
          role="img"
          aria-label={`kWh per day for ${periodLabel}`}
        >
          {/* Horizontal gridlines + y labels */}
          {yTicks.map((t) => {
            const y = py(t);
            return (
              <g key={t}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  stroke-opacity={0.12}
                  stroke-dasharray={t === 0 ? undefined : "2 4"}
                  class="text-muted-foreground"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  text-anchor="end"
                  class="fill-muted-foreground"
                  font-size="10"
                >
                  {t.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </text>
              </g>
            );
          })}

          {/* x labels */}
          {points.map((p, i) => {
            if (i % labelEvery !== 0 && i !== n - 1) return null;
            return (
              <text
                key={p.date + i}
                x={px(i)}
                y={H - 8}
                text-anchor="middle"
                class="fill-muted-foreground"
                font-size="10"
              >
                {formatDayLabel(p.date)}
              </text>
            );
          })}

          {hasAny && (
            <>
              {/* Area fill */}
              <path
                d={areaPath}
                fill="currentColor"
                fill-opacity={0.12}
              />
              {/* Line */}
              <path
                d={linePath}
                fill="none"
                stroke="currentColor"
                stroke-width={2}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              {/* Dots — only for short series to avoid clutter */}
              {n <= 40 && points.map((p, i) =>
                p.kwh > 0
                  ? (
                    <circle
                      key={"d" + i}
                      cx={px(i)}
                      cy={py(p.kwh)}
                      r={2.5}
                      fill="currentColor"
                    />
                  )
                  : null
              )}
            </>
          )}

          {!hasAny && (
            <text
              x={W / 2}
              y={H / 2}
              text-anchor="middle"
              class="fill-muted-foreground"
              font-size="12"
            >
              No usage yet
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
