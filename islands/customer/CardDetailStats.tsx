/**
 * Polaris Track G2 — Stats SectionCard for the customer Card detail page.
 *
 * Receives the Track F `/api/customer/cards/[id].card.stats` payload and
 * renders three MetricTiles inside a `SectionCard accent="cyan"`. No live
 * updates today — exposed as an island so a future SSE-driven "current
 * session" overlay (per the plan's "Cards detail page — live current
 * session if this card is in use" point) can mount without a directory move.
 *
 * Pure presentational + no signals/effects today; an island wrapper costs
 * a few bytes but unlocks the future hook without disturbing callers.
 */

import { Activity, BarChart3, BatteryCharging, Receipt } from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";

interface Props {
  totalSessions: number;
  totalKwh: number;
  /** Total spent in cents — null until billing reconciliation lands. */
  totalSpentCents: number | null;
  totalSpentCurrency: string | null;
}

function formatCost(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const c = (cents / 100).toFixed(2);
  return currency ? `${currency.toUpperCase()} ${c}` : `€${c}`;
}

export default function CardDetailStats({
  totalSessions,
  totalKwh,
  totalSpentCents,
  totalSpentCurrency,
}: Props) {
  return (
    <SectionCard title="Stats" icon={BarChart3} accent="cyan">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-6 py-2">
        <MetricTile
          icon={Activity}
          label="Total sessions"
          value={<span class="tabular-nums">{totalSessions}</span>}
          accent="cyan"
        />
        <MetricTile
          icon={BatteryCharging}
          label="Total kWh"
          value={<span class="tabular-nums">{totalKwh.toFixed(2)} kWh</span>}
          accent="green"
        />
        <MetricTile
          icon={Receipt}
          label="Total spent"
          value={formatCost(totalSpentCents, totalSpentCurrency)}
          accent="teal"
        />
      </div>
    </SectionCard>
  );
}
