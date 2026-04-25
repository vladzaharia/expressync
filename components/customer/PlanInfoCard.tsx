/**
 * PlanInfoCard — compact plan summary rendered in the Usage section of the
 * customer dashboard. Pure server component — no interactivity.
 *
 * Layout (top-down):
 *   Plan name (prominent)
 *   <Separator />
 *   Monthly charge    (only when > 0)
 *   Per-kWh charge    (only when set)
 *   <Separator />
 *   Progress bars (one per tier for tiered plans, one for flat plans)
 *
 * Progress bar logic mirrors the /billing page's mental model: each tier
 * gets its own bar, filled by the consumed kWh in that tier. For a flat
 * plan with a hard cap the single bar uses that cap. Unlimited plans
 * render a single full bar whenever usage exists (symbolic "you're
 * charging").
 */

import { Separator } from "@/components/ui/separator.tsx";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface PlanTier {
  /**
   * How many kWh this tier covers. `null` = no upper bound (i.e. the last
   * tier; everything above previous tiers falls into it). For a free
   * allowance "100 kWh free" this is 100.
   */
  upToKwh: number | null;
  /**
   * Per-kWh price in major units (e.g. "0.15"). `null` or "0" = free.
   */
  pricePerKwh: number | null;
  /** Display label for the right side of the bar. */
  label: string;
}

export interface PlanInfo {
  /** Friendly plan name (Lago `name` or `plan_code` fallback). */
  name: string;
  /** Currency symbol — typically from the invoice currency ("€", "$", …). */
  currencySymbol: string;
  /** Monthly subscription charge in major units; null = no flat fee. */
  monthlyCharge: number | null;
  /**
   * Flat per-kWh charge in major units (when the plan is non-tiered). Null
   * when tiered or when the plan has no usage-based component.
   */
  perKwhCharge: number | null;
  /** Tier breakdown; empty means flat/unlimited. */
  tiers: PlanTier[];
  /** Consumed kWh for the current period (drives bar fill). */
  consumedKwh: number;
  /** Hard cap (for flat plans) — null = unlimited. */
  hardCapKwh: number | null;
}

interface Props {
  plan: PlanInfo | null;
  accent?: AccentColor;
  className?: string;
}

function formatKwh(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatMoney(sym: string, amount: number): string {
  return `${sym}${
    amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/**
 * Walk the tier list in order and compute how many kWh fall into each tier
 * given the consumed total. Returns the same length as `tiers`.
 */
function splitConsumedAcrossTiers(
  tiers: PlanTier[],
  consumed: number,
): number[] {
  const out: number[] = [];
  let remaining = consumed;
  for (const t of tiers) {
    const cap = t.upToKwh == null ? Infinity : t.upToKwh;
    const used = Math.max(0, Math.min(remaining, cap));
    out.push(used);
    remaining -= used;
    if (remaining <= 0 && t.upToKwh != null) {
      // No more consumption left to distribute.
      remaining = 0;
    }
  }
  return out;
}

export function PlanInfoCard(
  { plan, accent = "blue", className }: Props,
) {
  if (!plan) {
    return (
      <div class={cn("text-sm text-muted-foreground", className)}>
        No plan on file yet.
      </div>
    );
  }

  const tone = stripToneClasses[accent];
  const perTierConsumed = splitConsumedAcrossTiers(
    plan.tiers,
    plan.consumedKwh,
  );

  return (
    <div class={cn("flex flex-col gap-5", className)}>
      <div class="flex flex-col gap-2">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          Plan
        </p>
        <p class="text-lg font-semibold leading-tight">{plan.name}</p>
      </div>

      {(plan.monthlyCharge != null && plan.monthlyCharge > 0) ||
          plan.perKwhCharge != null
        ? (
          <>
            <Separator />
            <dl class="flex flex-col gap-1.5 text-sm">
              {plan.monthlyCharge != null && plan.monthlyCharge > 0 && (
                <div class="flex items-baseline justify-between gap-3">
                  <dt class="text-muted-foreground">Monthly</dt>
                  <dd class="font-medium tabular-nums">
                    {formatMoney(plan.currencySymbol, plan.monthlyCharge)}
                  </dd>
                </div>
              )}
              {plan.perKwhCharge != null && (
                <div class="flex items-baseline justify-between gap-3">
                  <dt class="text-muted-foreground">Per kWh</dt>
                  <dd class="font-medium tabular-nums">
                    {plan.perKwhCharge === 0
                      ? "Free"
                      : formatMoney(plan.currencySymbol, plan.perKwhCharge)}
                  </dd>
                </div>
              )}
            </dl>
          </>
        )
        : null}

      <Separator />

      <div class="flex flex-col gap-3">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          Usage
        </p>
        {plan.tiers.length > 0
          ? (
            plan.tiers.map((tier, i) => {
              const consumed = perTierConsumed[i] ?? 0;
              const cap = tier.upToKwh ?? 0;
              const pct = cap > 0 ? Math.min(1, consumed / cap) : 0;
              const capLabel = tier.upToKwh == null
                ? `${formatKwh(consumed)} kWh`
                : `${formatKwh(consumed)}/${formatKwh(tier.upToKwh)} kWh`;
              // Unbounded trailing tier: show the bar as "accumulating"
              // fraction of max(consumed, 1) so the UI reads like it's in use.
              const barStyle = tier.upToKwh == null
                ? { width: consumed > 0 ? "100%" : "0%" }
                : { width: `${(pct * 100).toFixed(1)}%` };

              return (
                <TierBar
                  key={i}
                  leftLabel={capLabel}
                  rightLabel={tier.label}
                  fillStyle={barStyle}
                  tone={tone}
                />
              );
            })
          )
          : (
            <TierBar
              leftLabel={plan.hardCapKwh == null
                ? `${formatKwh(plan.consumedKwh)} kWh`
                : `${formatKwh(plan.consumedKwh)}/${
                  formatKwh(plan.hardCapKwh)
                } kWh`}
              rightLabel={plan.hardCapKwh == null ? "Unlimited" : "Cap"}
              fillStyle={plan.hardCapKwh == null
                ? { width: plan.consumedKwh > 0 ? "100%" : "0%" }
                : {
                  width: `${
                    (Math.min(1, plan.consumedKwh / plan.hardCapKwh) * 100)
                      .toFixed(1)
                  }%`,
                }}
              tone={tone}
            />
          )}
      </div>
    </div>
  );
}

function TierBar({
  leftLabel,
  rightLabel,
  fillStyle,
  tone,
}: {
  leftLabel: string;
  rightLabel: string;
  fillStyle: { width: string };
  tone: { iconWell: string };
}) {
  // Derive the fill color from the accent's `iconWell` class — it already
  // carries the right saturation. This keeps colors driven off `stripToneClasses`.
  const fillClass = tone.iconWell.split(" ").find((c) => c.startsWith("bg-")) ??
    "bg-primary";

  return (
    <div class="flex flex-col gap-1">
      <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          class={cn("h-full rounded-full transition-[width]", fillClass)}
          style={fillStyle}
          aria-hidden="true"
        />
      </div>
      <div class="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
