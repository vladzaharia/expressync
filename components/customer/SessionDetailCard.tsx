/**
 * Polaris Track G2 — server-rendered detail tiles for the customer Session
 * detail page.
 *
 * The plan calls this `SessionDetailCard` and notes: "server-rendered if
 * data is static; island only if interactive elements (e.g., live updates)
 * need it." None of the per-tile data here is live — the loader fetches
 * once, the LiveSessionCard island handles in-flight updates separately —
 * so this stays a plain Preact component.
 *
 * Renders two SectionCards:
 *   - "Summary": kWh / Duration / Cost / Avg kW (cost wraps in a cross-link
 *     to the related invoice once Lago invoice resolution lands)
 *   - "Charger": charger label + connector + Card used (cross-link to
 *     /cards/[ocppTagPk] when the loader resolved the mapping PK)
 *
 * Cross-link rule (per "Cross-links pattern" in the plan): wrap the
 * MetricTile in `<a>` so the whole tile is the click target. Server loader
 * resolves `ocppTagPk` so the link only renders when ownership is real.
 */

import {
  Activity,
  BatteryCharging,
  Clock,
  CreditCard,
  Gauge,
  Receipt,
  Zap,
} from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";

interface SessionDetailCardProps {
  session: {
    id: number;
    steveTransactionId: number;
    ocppTag: string | null;
    /** user_mappings.id — distinct from `ocppTagPk` (StEvE tag PK). */
    ocppTagMappingId: number | null;
    mappingDisplayName: string | null;
    kwhDelta: string | number;
    meterValueFrom: number;
    meterValueTo: number;
    isFinal: boolean | null;
    syncedAt: string | null;
  };
  /** Total kWh delivered across the entire StEvE transaction. */
  totalKwh: number;
  /** Total seconds elapsed across the StEvE transaction (start → end / now). */
  totalDurationSeconds: number | null;
  /** Per-kWh ÷ duration (avg power); null when duration unknown / zero. */
  avgKw: number | null;
  /** Estimated cost in cents (resolved from Lago, may be null pre-billing). */
  costCents: number | null;
  costCurrency: string | null;
  /** Lago invoice id for cross-link (null until invoice issued). */
  invoiceId: string | null;
  /** Charger box id from the StEvE transaction (when known). */
  chargeBoxId: string | null;
  /** Connector index on the charger (when known). */
  connectorId: number | null;
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null) return "—";
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function formatCost(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const c = (cents / 100).toFixed(2);
  return currency ? `${currency.toUpperCase()} ${c}` : `€${c}`;
}

export function SessionDetailCard({
  session,
  totalKwh,
  totalDurationSeconds,
  avgKw,
  costCents,
  costCurrency,
  invoiceId,
  chargeBoxId,
  connectorId,
}: SessionDetailCardProps) {
  const cardLink = session.ocppTagMappingId !== null
    ? `/cards/${session.ocppTagMappingId}`
    : null;
  const cardDisplay = session.mappingDisplayName ?? session.ocppTag ?? "—";

  // Cost tile becomes a cross-link to the related invoice once we have one.
  const costTile = (
    <MetricTile
      icon={Receipt}
      label="Cost"
      value={
        <span class="tabular-nums">
          {formatCost(costCents, costCurrency)}
        </span>
      }
      sublabel={invoiceId ? "View invoice" : undefined}
      accent="teal"
    />
  );

  return (
    <div class="space-y-6">
      <SectionCard title="Summary" icon={Activity} accent="green">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
          <MetricTile
            icon={BatteryCharging}
            label="Energy"
            value={<span class="tabular-nums">{totalKwh.toFixed(2)} kWh</span>}
            accent="green"
          />
          <MetricTile
            icon={Clock}
            label="Duration"
            value={
              <span class="tabular-nums">
                {formatDuration(totalDurationSeconds)}
              </span>
            }
            accent="amber"
          />
          {invoiceId
            ? (
              <a
                href={`/billing/invoices/${invoiceId}`}
                class="block hover:opacity-80 transition-opacity rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {costTile}
              </a>
            )
            : costTile}
          <MetricTile
            icon={Gauge}
            label="Avg power"
            value={
              <span class="tabular-nums">
                {avgKw != null ? `${avgKw.toFixed(2)} kW` : "—"}
              </span>
            }
            accent="cyan"
          />
        </div>
      </SectionCard>

      <SectionCard title="Charger" icon={Zap} accent="green">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-6 py-2">
          <MetricTile
            icon={Zap}
            label="Charger"
            value={
              <span class="font-mono text-sm">
                {chargeBoxId ?? "—"}
              </span>
            }
            accent="blue"
          />
          <MetricTile
            icon={Activity}
            label="Connector"
            value={connectorId != null
              ? <span class="tabular-nums">#{connectorId}</span>
              : "—"}
            accent="emerald"
          />
          {cardLink
            ? (
              <a
                href={cardLink}
                class="block hover:opacity-80 transition-opacity rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <MetricTile
                  icon={CreditCard}
                  label="Card used"
                  value={cardDisplay}
                  sublabel="View card"
                  accent="cyan"
                />
              </a>
            )
            : (
              <MetricTile
                icon={CreditCard}
                label="Card used"
                value={cardDisplay}
                accent="cyan"
              />
            )}
        </div>
      </SectionCard>
    </div>
  );
}
