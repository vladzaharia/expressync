/**
 * CustomerPicker — owns the Lago-customer side of the linking form.
 *
 * Behavior:
 *   - Fetches `/api/admin/customer` (Lago customers, name+external_id).
 *   - Client-side search (filters on name / external_id).
 *   - Selected view collapses to a summary chip with a `Change` button.
 *   - Empty-state (zero Lago customers) renders an external deep-link to
 *     create one in Lago — we do not create customers from this admin UI.
 *
 * Emits `onChange(customerExternalId)` whenever the selection changes.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ExternalLink, Loader2, User } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export interface LagoCustomerOption {
  id: string;
  name: string;
}

interface Props {
  value: string | null;
  onChange: (id: string) => void;
  /** If set, show an external link to create a customer in Lago when the
   *  fetched list is empty. */
  lagoDashboardUrl?: string | null;
  label?: string;
}

export default function CustomerPicker(
  { value, onChange, lagoDashboardUrl, label }: Props,
) {
  const customers = useSignal<LagoCustomerOption[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/customer");
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) customers.value = data;
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) loading.value = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useComputed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return customers.value;
    return customers.value.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  });

  const selected = useComputed(() =>
    customers.value.find((c) => c.id === value) ?? null
  );

  // Selected state
  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label ?? "Select Lago Customer"}</Label>
        <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <User className="size-5 text-violet-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold truncate">
                  {selected.value?.name ?? value}
                </h3>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {value}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange("")}
              className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
            >
              Change
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading.value) {
    return (
      <div className="space-y-2">
        <Label>{label ?? "Select Lago Customer"}</Label>
        <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Loading customers…
        </div>
      </div>
    );
  }

  // Empty-state (no Lago customers at all)
  if (customers.value.length === 0) {
    const href = lagoDashboardUrl ? `${lagoDashboardUrl}/customers/new` : null;
    return (
      <div className="space-y-2">
        <Label>{label ?? "Select Lago Customer"}</Label>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-6 text-center space-y-3">
          <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
            No customers in Lago yet.
          </p>
          <p className="text-xs text-muted-foreground">
            Create a customer in Lago, then return here to complete the link.
          </p>
          {href && (
            <Button
              type="button"
              variant="outline"
              asChild
            >
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4 mr-1" aria-hidden="true" />
                <span>Create customer in Lago</span>
                <span className="sr-only">(opens in new tab)</span>
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Grid of candidates
  return (
    <div className="space-y-3">
      <Label>{label ?? "Select Lago Customer"}</Label>
      <Input
        placeholder="Search by name or external id…"
        value={search.value}
        onInput={(e) => (search.value = (e.target as HTMLInputElement).value)}
      />
      {filtered.value.length === 0
        ? (
          <div className="bg-muted rounded-lg p-4 text-center text-sm text-muted-foreground">
            No customers match "{search.value}".
          </div>
        )
        : (
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1"
            role="listbox"
            aria-label="Lago customers"
          >
            {filtered.value.map((customer) => (
              <button
                key={customer.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onChange(customer.id)}
                className="text-left border-2 border-border hover:border-violet-500/70 rounded-lg p-3 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <div className="flex items-start gap-3">
                  <User className="size-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">
                      {customer.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                      {customer.id}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
