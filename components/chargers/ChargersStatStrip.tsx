/**
 * ChargersStatStrip — compact stats row above the `/chargers` grid.
 *
 * Four cells, orange-accented to match the Chargers page tone:
 *   1. Online           — derived from charger freshness + uiStatus
 *   2. Offline          — complement; when > 0 shown as amber warning,
 *                         otherwise muted
 *   3. Charging now     — count of open transactions (sync state rows where
 *                         is_finalized = false)
 *   4. kWh (24h)        — sum of synced_transaction_events.kwh_delta in the
 *                         last 24h
 *
 * Server-rendered; no client state. Modeled after
 * `components/links/LinkingStatStrip.tsx` (visual parity with the other
 * refreshed surfaces).
 */

import { AlertTriangle, Gauge, Wifi, WifiOff, Zap } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";

interface Totals {
  online: number;
  offline: number;
  chargingNow: number;
  kwhLast24h: number;
}

interface Props {
  totals: Totals;
  class?: string;
}

type Tone = "orange" | "amber" | "muted";

function Cell(
  { label, value, icon, tone = "orange" }: {
    label: string;
    value: ComponentChildren;
    icon: ComponentChildren;
    tone?: Tone;
  },
) {
  const toneClass = {
    orange:
      "border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300",
    amber:
      "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    muted: "border-border bg-muted/20 text-foreground",
  }[tone];

  return (
    <div
      class={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3",
        toneClass,
      )}
    >
      <span class="flex size-9 items-center justify-center rounded-md bg-background/80">
        {icon}
      </span>
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p class="text-lg font-semibold leading-tight tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export function ChargersStatStrip({ totals, class: className }: Props) {
  const offlineWarning = totals.offline > 0;
  const kwhZero = totals.kwhLast24h <= 0;
  const kwhDisplay = `${totals.kwhLast24h.toFixed(1)} kWh`;

  return (
    <div
      class={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4",
        className,
      )}
    >
      <Cell
        label="Online"
        value={totals.online}
        icon={<Wifi class="size-4 text-orange-500" />}
        tone="orange"
      />
      <Cell
        label="Offline"
        value={totals.offline}
        icon={offlineWarning
          ? <AlertTriangle class="size-4 text-amber-500" />
          : <WifiOff class="size-4 text-muted-foreground" />}
        tone={offlineWarning ? "amber" : "muted"}
      />
      <Cell
        label="Charging now"
        value={totals.chargingNow}
        icon={<Zap class="size-4 text-orange-500" />}
        tone="orange"
      />
      <Cell
        label="kWh (24h)"
        value={
          <span class={kwhZero ? "text-muted-foreground" : undefined}>
            {kwhDisplay}
          </span>
        }
        icon={<Gauge class="size-4 text-orange-500" />}
        tone="orange"
      />
    </div>
  );
}
