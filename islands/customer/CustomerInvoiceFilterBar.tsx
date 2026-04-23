/**
 * CustomerInvoiceFilterBar — URL-backed filter chips for the customer
 * Billing → Invoices section.
 *
 * Polaris Track G — narrower cousin of the admin `InvoiceFilters`. Three
 * filter axes:
 *
 *   - status (multi-select chips: Open / Paid / Voided)
 *       "Open" = `finalized` + payment_status != succeeded (active billable)
 *       "Paid" = `paid`
 *       "Voided" = `voided`
 *   - issuing date range (from / to) — YYYY-MM-DD via <Input type="date">
 *   - reset button — clears everything by navigating to `/billing`
 *
 * Submitting reloads the page with a fresh query string so the loader's
 * Lago call reflects the new filters. This matches the established
 * "filters are URL state, not AJAX" pattern from the admin invoices page.
 *
 * When the user lives inside the Billing PageCard (the page mounts the
 * filter bar inside the SectionCard), navigation preserves the
 * `#invoices` anchor so the invoices section stays in view after reload.
 */

import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

/**
 * Three customer-friendly filter buckets. Maps to Lago `status` +
 * `payment_status` query params on the server side.
 */
export type CustomerInvoiceFilter = "open" | "paid" | "voided";

const FILTER_LABELS: Record<CustomerInvoiceFilter, string> = {
  open: "Open",
  paid: "Paid",
  voided: "Voided",
};

interface Props {
  initial: {
    status: CustomerInvoiceFilter[];
    from: string;
    to: string;
  };
  /** Pathname to navigate to (defaults to `/billing`). */
  basePath?: string;
}

export default function CustomerInvoiceFilterBar(
  { initial, basePath = "/billing" }: Props,
) {
  const statusSet = useSignal<Set<CustomerInvoiceFilter>>(
    new Set(initial.status),
  );
  const dateFrom = useSignal(initial.from);
  const dateTo = useSignal(initial.to);

  const toggle = (s: CustomerInvoiceFilter) => {
    const next = new Set(statusSet.value);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    statusSet.value = next;
  };

  const apply = () => {
    const params = new URLSearchParams();
    for (const s of statusSet.value) params.append("status", s);
    if (dateFrom.value) params.set("from", dateFrom.value);
    if (dateTo.value) params.set("to", dateTo.value);
    const qs = params.toString();
    globalThis.location.href = qs
      ? `${basePath}?${qs}#invoices`
      : `${basePath}#invoices`;
  };

  const reset = () => {
    globalThis.location.href = `${basePath}#invoices`;
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1">
          Status
        </span>
        {(Object.keys(FILTER_LABELS) as CustomerInvoiceFilter[]).map((s) => {
          const active = statusSet.value.has(s);
          return (
            <button
              type="button"
              key={s}
              aria-pressed={active}
              onClick={() => toggle(s)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium capitalize",
                active
                  ? "border-teal-500/40 bg-teal-500/15 text-teal-700 dark:text-teal-300"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {FILTER_LABELS[s]}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="cust-inv-from" className="text-xs">From</Label>
          <Input
            id="cust-inv-from"
            type="date"
            value={dateFrom.value}
            onInput={(e) => {
              dateFrom.value = (e.currentTarget as HTMLInputElement).value;
            }}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="cust-inv-to" className="text-xs">To</Label>
          <Input
            id="cust-inv-to"
            type="date"
            value={dateTo.value}
            onInput={(e) => {
              dateTo.value = (e.currentTarget as HTMLInputElement).value;
            }}
            className="mt-1"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" onClick={reset} type="button">
            Reset
          </Button>
          <Button size="sm" onClick={apply} type="button">
            Apply filters
          </Button>
        </div>
      </div>
    </div>
  );
}
