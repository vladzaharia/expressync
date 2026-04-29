/**
 * <PlanName /> — render a Lago plan/subscription name with the tier
 * suffix gradiented.
 *
 * The product names follow `ExpressCharge` + optional tier suffix:
 *   ExpressCharge      → base, no gradient
 *   ExpressChargeM     → Monthly       (emerald → teal)
 *   ExpressCharge+     → Plus          (violet  → fuchsia)
 *   ExpressChargeAC    → At Cost       (amber   → orange)
 *
 * The base text inherits foreground color; only the tier glyph(s) get the
 * gradient. Tailwind JIT requires the class strings to appear literally in
 * source, hence the explicit map below.
 */

import { cn } from "@/src/lib/utils/cn.ts";

export type PlanTier = "monthly" | "plus" | "atcost" | "base";

interface TierSpec {
  tier: PlanTier;
  /** Gradient classes applied to the suffix glyph. */
  gradient: string;
  /** Display label used by `tierLabel()`. */
  label: string;
}

const TIER_BY_SUFFIX: Record<string, TierSpec> = {
  M: {
    tier: "monthly",
    gradient: "from-emerald-400 to-teal-500",
    label: "Monthly",
  },
  "+": {
    tier: "plus",
    gradient: "from-violet-400 to-fuchsia-500",
    label: "Plus",
  },
  AC: {
    tier: "atcost",
    gradient: "from-amber-400 to-orange-500",
    label: "At Cost",
  },
};

const BASE_SPEC: TierSpec = { tier: "base", gradient: "", label: "Base" };

/**
 * Detect the tier suffix at the end of a plan/subscription name. Returns
 * `{ base, suffix, spec }`. `suffix` is empty when no tier matches.
 */
function splitName(
  name: string,
): { base: string; suffix: string; spec: TierSpec } {
  // Order matters: longest match first so "AC" beats "C" if we ever add C.
  for (const suffix of ["AC", "M", "+"] as const) {
    if (name.endsWith(suffix)) {
      return { base: name.slice(0, -suffix.length), suffix, spec: TIER_BY_SUFFIX[suffix] };
    }
  }
  return { base: name, suffix: "", spec: BASE_SPEC };
}

/** Canonical tier for a plan/subscription name. */
export function planTier(name: string): PlanTier {
  return splitName(name).spec.tier;
}

/** Friendly tier label ("Monthly", "Plus", "At Cost", "Base"). */
export function planTierLabel(name: string): string {
  return splitName(name).spec.label;
}

interface Props {
  name: string;
  className?: string;
}

export function PlanName({ name, className }: Props) {
  const { base, suffix, spec } = splitName(name);
  return (
    <span class={cn("inline-flex items-baseline font-semibold", className)}>
      <span>{base}</span>
      {suffix && (
        <span
          class={cn(
            "bg-gradient-to-r bg-clip-text text-transparent",
            spec.gradient,
          )}
          aria-label={spec.label}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}

export default PlanName;
