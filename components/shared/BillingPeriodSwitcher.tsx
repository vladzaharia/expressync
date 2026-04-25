/**
 * BillingPeriodSwitcher — three URL-backed period chips.
 *
 * Polaris Track G — appears in the customer Billing "Usage" SectionCard
 * (and possibly elsewhere). Three options:
 *
 *   - current  → ?period=current  (default)
 *   - previous → ?period=previous
 *   - year     → ?period=year
 *
 * Selection updates the URL via a full navigation (NOT AJAX) so the page
 * loader reruns. We intentionally avoid client-side fetching for the same
 * reason invoice filters do: the loader is the single source of truth and
 * the URL is the canonical UI state.
 *
 * `value` is the currently selected period (driven by the loader). The
 * component renders single-select toggle chips via the canonical
 * `ToggleGroup` primitive in `outline-joined` mode so the chip strip reads
 * as a connected segment.
 */

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export type BillingPeriod = "current" | "previous" | "year";

const PERIOD_LABELS: Record<BillingPeriod, string> = {
  current: "Current",
  previous: "Previous",
  year: "Year",
};

interface Props {
  value: BillingPeriod;
  /** Pathname that the chip navigates to (defaults to current location). */
  basePath?: string;
  /** Extra classes merged onto the toggle group root. */
  className?: string;
  /**
   * Optional whitelist of supported periods. Unsupported options render as
   * disabled chips (aria-disabled + muted) rather than navigating to broken
   * states. Defaults to all three.
   */
  supportedPeriods?: BillingPeriod[];
}

/**
 * Build a target URL preserving every existing query param except `period`,
 * which is replaced. Returns a path-only URL so the navigation stays on the
 * same hostname.
 */
function buildHref(basePath: string, period: BillingPeriod): string {
  if (typeof globalThis.location === "undefined") {
    // SSR — emit a plain path with the chosen period. Loader will normalise.
    return `${basePath}?period=${period}`;
  }
  const url = new URL(globalThis.location.href);
  url.pathname = basePath;
  url.searchParams.set("period", period);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export function BillingPeriodSwitcher(
  { value, basePath = "/billing", className, supportedPeriods }: Props,
) {
  const supported = supportedPeriods
    ? new Set(supportedPeriods)
    : null;
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next: string) => {
        if (!next) return;
        if (next === value) return;
        if (supported && !supported.has(next as BillingPeriod)) return;
        globalThis.location.href = buildHref(
          basePath,
          next as BillingPeriod,
        );
      }}
      variant="outline-joined"
      size="sm"
      aria-label="Billing period"
      className={cn("inline-flex", className)}
    >
      {(Object.keys(PERIOD_LABELS) as BillingPeriod[]).map((p) => {
        const isDisabled = supported ? !supported.has(p) : false;
        return (
          <ToggleGroupItem
            key={p}
            value={p}
            disabled={isDisabled}
            aria-disabled={isDisabled || undefined}
            aria-label={`Show ${PERIOD_LABELS[p].toLowerCase()} period`}
            className={cn(
              isDisabled && "text-muted-foreground opacity-50",
            )}
          >
            {PERIOD_LABELS[p]}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
