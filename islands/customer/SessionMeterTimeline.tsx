/**
 * Polaris Track G2 — vertical meter-reading timeline for the customer
 * session detail page.
 *
 * Renders the array returned by `/api/customer/sessions/[id].meterTimeline`
 * (one row per `synced_transaction_events` row sharing the StEvE
 * transaction id). Each row shows:
 *   - timestamp (relative + absolute on hover)
 *   - meter value (kWh — converted from Wh stored in the DB)
 *   - delta (kWh) — what was billed in this interval
 *   - "final" badge on the final event
 *
 * The component is presentational only — no SSE, no timers — so it could
 * live in `components/customer/`. We keep it as an island so a future
 * sparkline / live-update extension doesn't require a directory move.
 *
 * MVP intentionally skips a desktop sparkline (the plan defers chart
 * polish to post-MVP). The vertical list is sortable client-side via the
 * `[reverse]` toggle.
 */

import { Activity, BatteryCharging, Clock } from "lucide-preact";
import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { StatusBadge } from "@/components/shared/index.ts";

export interface MeterTimelineRow {
  id: number;
  syncedAt: string | null;
  kwhDelta: string | number;
  meterValueFrom: number;
  meterValueTo: number;
  isFinal: boolean | null;
}

interface Props {
  rows: MeterTimelineRow[];
}

function whToKwh(wh: number): string {
  return (wh / 1000).toFixed(3);
}

function deltaKwh(row: MeterTimelineRow): string {
  const v = typeof row.kwhDelta === "string"
    ? parseFloat(row.kwhDelta)
    : row.kwhDelta;
  if (!Number.isFinite(v)) return "0.000";
  return v.toFixed(3);
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function SessionMeterTimeline({ rows }: Props) {
  const reverse = useSignal(false);

  if (rows.length === 0) {
    return (
      <div class="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Activity class="size-8 opacity-50" />
        <p class="text-sm">No meter readings yet</p>
        <p class="text-xs">Readings appear as your session progresses.</p>
      </div>
    );
  }

  const ordered = reverse.value ? [...rows].reverse() : rows;

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-muted-foreground">
          {rows.length} reading{rows.length === 1 ? "" : "s"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reverse.value = !reverse.value;
          }}
        >
          {reverse.value ? "Oldest first" : "Newest first"}
        </Button>
      </div>

      <ol class="relative ml-3 border-l border-border pl-6 space-y-4">
        {ordered.map((row) => (
          <li key={row.id} class="relative">
            <span
              class="absolute -left-[31px] top-1 flex size-5 items-center justify-center rounded-full border bg-card"
              aria-hidden="true"
            >
              <BatteryCharging class="size-3 text-emerald-500" />
            </span>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock class="size-3" />
                <time
                  title={formatTimestamp(row.syncedAt)}
                  dateTime={row.syncedAt ?? undefined}
                >
                  {formatTimestamp(row.syncedAt)}
                </time>
                {row.isFinal && <StatusBadge tone="success" label="Final" />}
              </div>
              <div class="font-medium tabular-nums">
                +{deltaKwh(row)} kWh
              </div>
            </div>
            <p class="mt-1 text-xs text-muted-foreground tabular-nums">
              {whToKwh(row.meterValueFrom)} kWh → {whToKwh(row.meterValueTo)}
              {" "}
              kWh
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
