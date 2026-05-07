/**
 * Customer-tariff helpers — used by surfaces that show "estimated cost"
 * alongside kWh (sessions list/table/detail, subscription recent activity).
 *
 * Tariff resolution returns the customer's *plan-level* charge schedule:
 * either a flat per-kWh rate (`standard` charge_model) or a tiered
 * breakdown (`graduated` / `volume`). For a per-session estimate we walk
 * tiers using the customer's running period total so each session's cost
 * reflects whatever tier(s) it actually fell into. Sessions outside the
 * current period get a flat-rate fallback when the plan has one and `null`
 * otherwise — accurate-cost-or-no-number, never a misleading guess.
 *
 * Authoritative billing still comes from Lago invoices; this is for the
 * customer's intuition while the period is open.
 */

import { lagoClient } from "./lago-client.ts";
import { currencySymbolFor, derivePlanInfo } from "./billing-derive.ts";
import type { PlanTier } from "@/components/customer/PlanInfoCard.tsx";

export interface CustomerTariff {
  /** Flat per-kWh rate in major units (when plan uses `standard`). */
  perKwh: number | null;
  /** Tiered breakdown — empty when the plan is flat or no plan present. */
  tiers: PlanTier[];
  currency: string;
  currencySymbol: string;
}

const FALLBACK: CustomerTariff = {
  perKwh: null,
  tiers: [],
  currency: "EUR",
  currencySymbol: "€",
};

export async function resolveCustomerTariff(
  externalCustomerId: string | null,
): Promise<CustomerTariff> {
  if (!externalCustomerId) return FALLBACK;
  try {
    const { subscriptions } = await lagoClient.getSubscriptions(
      externalCustomerId,
    );
    const active = subscriptions.find((s) => s.status === "active");
    if (!active?.plan_code) return FALLBACK;

    const planRaw = await lagoClient.getPlan(active.plan_code).catch(() =>
      null
    );
    if (!planRaw) return FALLBACK;

    const currency =
      (planRaw as { amount_currency?: string }).amount_currency ??
        FALLBACK.currency;
    const symbol = currencySymbolFor(currency);
    const planInfo = derivePlanInfo(
      planRaw as unknown as Record<string, unknown>,
      0,
      symbol,
    );
    return {
      perKwh: planInfo?.perKwhCharge ?? null,
      tiers: planInfo?.tiers ?? [],
      currency,
      currencySymbol: symbol,
    };
  } catch {
    return FALLBACK;
  }
}

export interface SessionCostEstimate {
  /**
   * Estimated cost in cents. `null` when the plan provides no rate at all
   * (no tiers, no flat fallback).
   */
  cents: number | null;
  /**
   * - `included` — the entire range was covered by a 0-rate tier (e.g.
   *   "first 100 kWh free"); UI should render "Included" not "$0.00".
   * - `billed`   — at least some of the range crossed a paid tier or the
   *   flat fallback.
   * - `unknown`  — no tariff information; UI should hide the cost.
   */
  coverage: "included" | "billed" | "unknown";
}

/**
 * Walk the tier ladder and compute cost (in cents) for the kWh range
 * `[fromKwh, fromKwh + sessionKwh)`. Tiers are *sequential* — `upToKwh`
 * is the size of each band, not an absolute cap.
 *
 * Tiers run out → fall back to `tariff.perKwh` when set; otherwise the
 * remainder contributes 0 and `coverage` stays at whatever it was.
 *
 * `coverage="included"` requires that EVERY billed kWh in the range fell
 * into a 0-rate tier — partial overlaps with paid tiers flip it to
 * `billed`.
 */
export function costCentsForRange(
  tariff: CustomerTariff,
  fromKwh: number,
  sessionKwh: number,
): SessionCostEstimate {
  if (!Number.isFinite(sessionKwh) || sessionKwh <= 0) {
    return { cents: 0, coverage: "included" };
  }

  // Flat plan — no tiers.
  if (tariff.tiers.length === 0) {
    if (tariff.perKwh == null) return { cents: null, coverage: "unknown" };
    if (tariff.perKwh === 0) return { cents: 0, coverage: "included" };
    return {
      cents: Math.round(sessionKwh * tariff.perKwh * 100),
      coverage: "billed",
    };
  }

  let cost = 0;
  let cursor = 0; // running cumulative kWh covered by tiers so far
  let position = fromKwh; // start of the unbilled range
  const end = fromKwh + sessionKwh;
  let anyPaidOverlap = false;

  for (const t of tariff.tiers) {
    const tierStart = cursor;
    const tierEnd = t.upToKwh == null ? Infinity : cursor + t.upToKwh;

    if (position < tierEnd) {
      const overlapStart = Math.max(position, tierStart);
      const overlapEnd = Math.min(end, tierEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const rate = t.pricePerKwh ?? 0;
      if (overlap > 0 && rate > 0) anyPaidOverlap = true;
      cost += overlap * rate;
      position = overlapEnd;
    }

    cursor = tierEnd;
    if (position >= end) break;
  }

  // Past the last tier — apply flat fallback when present.
  if (position < end && tariff.perKwh != null) {
    const remainder = end - position;
    if (tariff.perKwh > 0) anyPaidOverlap = true;
    cost += remainder * tariff.perKwh;
  }

  return {
    cents: Math.round(cost * 100),
    coverage: anyPaidOverlap ? "billed" : "included",
  };
}

/**
 * Build an event-id → cumulative-kWh-before-event map by walking the
 * given rows in chronological order. Caller passes the full set of
 * `synced_transaction_events` rows within the current billing period
 * (NOT just the visible page) so cumulative position is correct for any
 * displayed row.
 */
export function buildCumulativeMap(
  rows: ReadonlyArray<{ id: number; syncedAtMs: number; kwh: number }>,
): Map<number, number> {
  const sorted = [...rows].sort((a, b) => a.syncedAtMs - b.syncedAtMs);
  const out = new Map<number, number>();
  let running = 0;
  for (const r of sorted) {
    out.set(r.id, running);
    running += Number.isFinite(r.kwh) ? r.kwh : 0;
  }
  return out;
}

/**
 * Estimate cost for a single `synced_transaction_events` row.
 *
 * - Sessions/events that straddle the period boundary attribute correctly:
 *   each event is judged by its own `syncedAtMs`, so a transaction that
 *   spans Mar 31 → Apr 1 has its early events priced against the prior
 *   period (returning `unknown` for tiered plans, since we can't
 *   reconstruct that period's running total from the live cumulative map)
 *   and its late events priced against the new period at their actual
 *   cumulative positions.
 * - For flat plans we always price; the period boundary is irrelevant.
 */
export function estimateEventCost(
  tariff: CustomerTariff,
  eventId: number,
  eventSyncedAtMs: number,
  eventKwh: number,
  cumulativeInPeriod: Map<number, number>,
  periodFromMs: number,
  periodToMs: number,
): SessionCostEstimate {
  if (tariff.tiers.length === 0) {
    return costCentsForRange(tariff, 0, eventKwh);
  }
  const inPeriod = eventSyncedAtMs >= periodFromMs &&
    eventSyncedAtMs < periodToMs;
  if (!inPeriod) return { cents: null, coverage: "unknown" };
  const before = cumulativeInPeriod.get(eventId) ?? 0;
  return costCentsForRange(tariff, before, eventKwh);
}

/** Aggregate per-event estimates into a single session-level estimate. */
export function aggregateEstimates(
  estimates: ReadonlyArray<SessionCostEstimate>,
): SessionCostEstimate {
  if (estimates.length === 0) return { cents: 0, coverage: "included" };
  let cents = 0;
  let anyBilled = false;
  let anyKnown = false;
  for (const e of estimates) {
    if (e.cents == null) continue; // unknown contributes nothing
    anyKnown = true;
    cents += e.cents;
    if (e.coverage === "billed") anyBilled = true;
  }
  if (!anyKnown) return { cents: null, coverage: "unknown" };
  return { cents, coverage: anyBilled ? "billed" : "included" };
}
