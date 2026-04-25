/**
 * PeriodBreakdownCard — companion to PeriodUsageChart on the customer
 * dashboard. Renders the "numbers behind the curve": days charged, peak
 * day, average on active days, and best single day.
 *
 * Pure server component — derives everything from the same daily series
 * the chart consumes, so no loader work.
 */

import { CalendarCheck2, Flame, Gauge, TrendingUp } from "lucide-preact";
import type { UsageDayPoint } from "@/islands/customer/PeriodUsageChart.tsx";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  points: UsageDayPoint[];
  accent?: AccentColor;
  className?: string;
}

function formatKwh(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function PeriodBreakdownCard(
  { points, accent = "blue", className }: Props,
) {
  const tone = stripToneClasses[accent];

  const activeDays = points.filter((p) => p.kwh > 0);
  const totalDays = points.length;
  const daysCharged = activeDays.length;
  const totalKwh = activeDays.reduce((s, p) => s + p.kwh, 0);
  const avgActive = daysCharged > 0 ? totalKwh / daysCharged : 0;
  const peak = activeDays.reduce(
    (acc, p) => (p.kwh > acc.kwh ? p : acc),
    { date: "", kwh: 0 } as UsageDayPoint,
  );

  const rows: Array<{
    icon: typeof Gauge;
    label: string;
    value: string;
    sub?: string;
    empty?: boolean;
  }> = [
    {
      icon: CalendarCheck2,
      label: "Days charged",
      value: totalDays > 0 ? `${daysCharged} / ${totalDays}` : "—",
      sub: totalDays > 0 ? "days in period" : undefined,
      empty: daysCharged === 0,
    },
    {
      icon: Flame,
      label: "Peak day",
      value: peak.kwh > 0 ? `${formatKwh(peak.kwh)} kWh` : "—",
      sub: peak.date ? formatShortDate(peak.date) : undefined,
      empty: peak.kwh === 0,
    },
    {
      icon: TrendingUp,
      label: "Avg on active days",
      value: avgActive > 0 ? `${formatKwh(avgActive)} kWh` : "—",
      sub: daysCharged > 0
        ? `across ${daysCharged} day${daysCharged === 1 ? "" : "s"}`
        : undefined,
      empty: avgActive === 0,
    },
    {
      icon: Gauge,
      label: "Period total",
      value: totalKwh > 0 ? `${formatKwh(totalKwh)} kWh` : "0 kWh",
      sub: totalKwh > 0 ? "billed so far" : "no usage yet",
      empty: totalKwh === 0,
    },
  ];

  return (
    <div class={cn("flex h-full flex-col gap-3", className)}>
      <p class="text-xs uppercase tracking-wide text-muted-foreground">
        Breakdown
      </p>
      <ul class="flex flex-col gap-2.5">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <li
              key={i}
              class={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2",
                r.empty ? "border-border/50 bg-muted/20" : tone.cell,
              )}
            >
              <span
                class={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  r.empty ? "bg-muted text-muted-foreground" : tone.iconWell,
                )}
              >
                <Icon class="h-4 w-4" aria-hidden="true" />
              </span>
              <div class="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                <div class="flex min-w-0 flex-col">
                  <span class="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {r.label}
                  </span>
                  {r.sub && (
                    <span class="truncate text-[11px] text-muted-foreground">
                      {r.sub}
                    </span>
                  )}
                </div>
                <span
                  class={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    r.empty ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {r.value}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
