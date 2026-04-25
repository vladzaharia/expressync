/**
 * billing-derive — shared helpers for customer dashboard + billing page
 * loaders. Centralises period-window math, local-day bucketing, currency
 * symbol mapping, and the Lago plan → `PlanInfo` derivation so both loaders
 * stay in lock-step.
 */

import type {
  PlanInfo,
  PlanTier,
} from "@/components/customer/PlanInfoCard.tsx";

export type BillingPeriod = "current" | "previous" | "year";

/** Start / end (exclusive) of the selected period, in local time. */
export function periodWindow(
  period: BillingPeriod,
): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (period === "year") {
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear() + 1, 0, 1);
    return { from, to, label: formatPeriodLabel(from, to) };
  }
  if (period === "previous") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to, label: formatPeriodLabel(from, to) };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from, to, label: formatPeriodLabel(from, to) };
}

/**
 * Format a period as an inclusive date range, e.g. "Apr 1 – Apr 30, 2026"
 * or "Jan 1 – Dec 31, 2026" when the window spans the full year. `to` is
 * exclusive (per the loader's convention), so the display end is `to - 1 day`.
 */
export function formatPeriodLabel(from: Date, to: Date): string {
  const endInclusive = new Date(to);
  endInclusive.setDate(endInclusive.getDate() - 1);
  const fromFmt = from.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endFmt = endInclusive.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const year = endInclusive.getFullYear();
  return `${fromFmt} – ${endFmt}, ${year}`;
}

/** Enumerate every local-midnight date between `from` (inclusive) and `to` (exclusive). */
export function enumerateDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur < end) {
    const y = cur.getFullYear();
    const m = (cur.getMonth() + 1).toString().padStart(2, "0");
    const d = cur.getDate().toString().padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function currencySymbolFor(code: string): string {
  switch (code.toUpperCase()) {
    case "EUR":
      return "€";
    case "USD":
      return "$";
    case "GBP":
      return "£";
    default:
      return code + " ";
  }
}

/**
 * Derive a PlanInfo from a Lago plan + current usage. Handles the common
 * charge_models: `standard`, `graduated`, `volume`, `package`.
 */
export function derivePlanInfo(
  planRaw: Record<string, unknown> | null,
  consumedKwh: number,
  currencySymbol: string,
): PlanInfo | null {
  if (!planRaw) return null;
  const name = typeof planRaw.name === "string" && planRaw.name.length > 0
    ? planRaw.name
    : typeof planRaw.code === "string"
    ? planRaw.code
    : "Plan";

  const amountCents = typeof planRaw.amount_cents === "number"
    ? planRaw.amount_cents
    : null;
  const monthlyCharge = amountCents != null ? amountCents / 100 : null;

  const charges = Array.isArray(planRaw.charges)
    ? planRaw.charges as Array<Record<string, unknown>>
    : [];

  let perKwhCharge: number | null = null;
  const tiers: PlanTier[] = [];
  let hardCapKwh: number | null = null;

  for (const charge of charges) {
    const model = charge.charge_model as string | undefined;
    const props = (charge.properties ?? {}) as Record<string, unknown>;

    if (model === "standard") {
      const rateRaw = props.amount;
      const rate = typeof rateRaw === "string" ? parseFloat(rateRaw) : rateRaw;
      if (typeof rate === "number" && Number.isFinite(rate)) {
        perKwhCharge = rate;
      }
      continue;
    }

    if (model === "graduated" || model === "volume") {
      const rangesKey = model === "graduated"
        ? "graduated_ranges"
        : "volume_ranges";
      const ranges = Array.isArray(props[rangesKey])
        ? props[rangesKey] as Array<Record<string, unknown>>
        : [];
      for (const r of ranges) {
        const toValueRaw = r.to_value;
        const fromValueRaw = r.from_value;
        const perUnitRaw = r.per_unit_amount ?? r.flat_amount ?? "0";
        const perUnit = typeof perUnitRaw === "string"
          ? parseFloat(perUnitRaw)
          : typeof perUnitRaw === "number"
          ? perUnitRaw
          : 0;
        const toValue = toValueRaw == null
          ? null
          : typeof toValueRaw === "number"
          ? toValueRaw
          : typeof toValueRaw === "string"
          ? parseFloat(toValueRaw)
          : null;
        const fromValue = typeof fromValueRaw === "number"
          ? fromValueRaw
          : typeof fromValueRaw === "string"
          ? parseFloat(fromValueRaw)
          : 0;
        const upTo = toValue != null && Number.isFinite(toValue)
          ? toValue - (Number.isFinite(fromValue) ? fromValue : 0)
          : null;
        const label = perUnit === 0
          ? "Free"
          : `${currencySymbol}${
            perUnit.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 4,
            })
          }/kWh`;
        tiers.push({
          upToKwh: upTo,
          pricePerKwh: Number.isFinite(perUnit) ? perUnit : null,
          label,
        });
      }
      continue;
    }

    if (model === "package") {
      const perPackage = typeof props.per_package_size === "number"
        ? props.per_package_size
        : typeof props.per_package_size === "string"
        ? parseFloat(props.per_package_size as string)
        : null;
      if (perPackage && Number.isFinite(perPackage) && perPackage > 0) {
        hardCapKwh = perPackage;
      }
      continue;
    }
  }

  return {
    name,
    currencySymbol,
    monthlyCharge,
    perKwhCharge,
    tiers,
    consumedKwh,
    hardCapKwh,
  };
}
