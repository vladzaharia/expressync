import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Search } from "lucide-preact";
import type { InvoiceUiStatus } from "@/src/lib/invoice-ui.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  initial: {
    status: InvoiceUiStatus[];
    search: string;
    issuingDateFrom: string;
    issuingDateTo: string;
    customerId: string;
  };
}

/**
 * Persistent URL-backed filter bar for the Invoices list page.
 *
 * Submitting the form rebuilds the URL query string and reloads the page
 * so the loader re-runs and the table reflects the new filter set.
 */
export default function InvoiceFilters({ initial }: Props) {
  const statusSet = useSignal<Set<InvoiceUiStatus>>(new Set(initial.status));
  const search = useSignal(initial.search);
  const dateFrom = useSignal(initial.issuingDateFrom);
  const dateTo = useSignal(initial.issuingDateTo);
  const customerId = useSignal(initial.customerId);

  const toggle = (s: InvoiceUiStatus) => {
    const next = new Set(statusSet.value);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    statusSet.value = next;
  };

  const apply = () => {
    const params = new URLSearchParams();
    for (const s of statusSet.value) params.append("status", s);
    if (search.value) params.set("search", search.value);
    if (dateFrom.value) params.set("from", dateFrom.value);
    if (dateTo.value) params.set("to", dateTo.value);
    if (customerId.value) params.set("customerId", customerId.value);
    const qs = params.toString();
    clientNavigate(qs ? `/invoices?${qs}` : "/invoices");
  };

  const reset = () => {
    clientNavigate("/invoices");
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    for (const s of statusSet.value) params.append("status", s);
    if (search.value) params.set("search", search.value);
    if (dateFrom.value) params.set("from", dateFrom.value);
    if (dateTo.value) params.set("to", dateTo.value);
    if (customerId.value) params.set("customerId", customerId.value);
    const qs = params.toString();
    // CSV export: bypass client-nav so the browser handles the file download.
    globalThis.location.assign(qs
      ? `/api/admin/invoice/export.csv?${qs}`
      : "/api/admin/invoice/export.csv");
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="inv-search" className="text-xs">
            Search
          </Label>
          <div className="relative mt-1">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="inv-search"
              placeholder="Invoice number, customer, email…"
              value={search.value}
              onInput={(e) => {
                search.value = (e.currentTarget as HTMLInputElement).value;
              }}
              className="pl-8"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="inv-from" className="text-xs">From</Label>
          <Input
            id="inv-from"
            type="date"
            value={dateFrom.value}
            onInput={(e) => {
              dateFrom.value = (e.currentTarget as HTMLInputElement).value;
            }}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="inv-to" className="text-xs">To</Label>
          <Input
            id="inv-to"
            type="date"
            value={dateTo.value}
            onInput={(e) => {
              dateTo.value = (e.currentTarget as HTMLInputElement).value;
            }}
            className="mt-1"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Status</span>
        {(
          [
            "draft",
            "finalized",
            "paid",
            "pending",
            "failed",
            "overdue",
            "voided",
          ] as const
        ).map((s) => {
          const active = statusSet.value.has(s);
          return (
            <button
              type="button"
              key={s}
              aria-pressed={active}
              onClick={() => toggle(s)}
              className={active
                ? "rounded-md border px-2.5 py-1 text-xs font-medium capitalize border-teal-500/40 bg-teal-500/15 text-teal-700 dark:text-teal-300"
                : "rounded-md border px-2.5 py-1 text-xs font-medium capitalize border-border text-muted-foreground hover:bg-muted/50"}
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Filter by customer external id"
            value={customerId.value}
            onInput={(e) => {
              customerId.value = (e.currentTarget as HTMLInputElement).value;
            }}
            className="text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reset}>
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
          <Button size="sm" onClick={apply}>
            Apply filters
          </Button>
        </div>
      </div>
    </div>
  );
}
