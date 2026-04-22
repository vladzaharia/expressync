/**
 * SubscriptionPicker — owns the Lago-subscription side of the linking form.
 *
 * Cascades on `customerId`:
 *   - No customer selected yet → muted placeholder.
 *   - 0 active subs for customer → yellow alert with external "Create in Lago"
 *     CTA. The mapping can still be saved (server will auto-select at sync
 *     time once a subscription appears).
 *   - Exactly 1 active sub → auto-select (after first customer change) and
 *     render a confirmation summary card with a `Change` button to re-open
 *     the picker.
 *   - 2+ subs → card grid.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  AlertTriangle,
  CreditCard,
  ExternalLink,
  Loader2,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";

export interface LagoSubscriptionOption {
  id: string;
  name: string;
  customerId: string;
}

interface Props {
  customerId: string | null;
  value: string | null;
  onChange: (id: string) => void;
  /** When true + the customer has exactly one active sub, auto-select it.
   *  Defaults to true — used to be manual in the old form. */
  autoSelectSingle?: boolean;
  lagoDashboardUrl?: string | null;
  label?: string;
}

export default function SubscriptionPicker(props: Props) {
  const {
    customerId,
    value,
    onChange,
    autoSelectSingle = true,
    lagoDashboardUrl,
    label,
  } = props;

  const subscriptions = useSignal<LagoSubscriptionOption[]>([]);
  const loading = useSignal(true);
  const pickerExpanded = useSignal(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/subscription");
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) subscriptions.value = data;
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
    if (!customerId) return [];
    return subscriptions.value.filter((s) => s.customerId === customerId);
  });

  // Auto-select: only when the customer changes and the filtered list has
  // exactly one match. We don't overwrite an existing selection.
  useEffect(() => {
    if (!autoSelectSingle) return;
    if (loading.value) return;
    if (!customerId) return;
    if (value) return;
    if (filtered.value.length === 1) {
      onChange(filtered.value[0].id);
    }
  }, [customerId, loading.value, filtered.value.length]);

  const selected = useComputed(() =>
    filtered.value.find((s) => s.id === value) ?? null
  );

  const labelText = label ?? "Select Lago Subscription";

  if (!customerId) {
    return (
      <div className="space-y-2">
        <Label>
          {labelText}{" "}
          <span className="text-muted-foreground text-xs">(Optional)</span>
        </Label>
        <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground text-sm">
          Please select a customer first.
        </div>
      </div>
    );
  }

  if (loading.value) {
    return (
      <div className="space-y-2">
        <Label>{labelText}</Label>
        <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Loading subscriptions…
        </div>
      </div>
    );
  }

  // 0 active → alert + external CTA
  if (filtered.value.length === 0) {
    const href = lagoDashboardUrl
      ? `${lagoDashboardUrl}/customer/${customerId}`
      : null;
    return (
      <div className="space-y-2">
        <Label>
          {labelText}{" "}
          <span className="text-muted-foreground text-xs">(Optional)</span>
        </Label>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-yellow-600 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <h4 className="font-semibold text-yellow-700 dark:text-yellow-400">
                No active subscriptions
              </h4>
              <p className="text-sm text-yellow-700/80 dark:text-yellow-400/80">
                This customer has no active subscriptions. You can still save
                this mapping — the first active subscription will be
                auto-selected at sync time, but the tag will remain inactive
                until that happens.
              </p>
              {href && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink
                      className="size-4 mr-1"
                      aria-hidden="true"
                    />
                    <span>Create subscription in Lago</span>
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single-sub confirmation summary (cleaner than a 1-card grid).
  if (
    autoSelectSingle &&
    filtered.value.length === 1 &&
    value &&
    !pickerExpanded.value
  ) {
    const sub = filtered.value[0];
    return (
      <div className="space-y-2">
        <Label>{labelText}</Label>
        <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CreditCard className="size-5 text-violet-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Will bill on
                </p>
                <h3 className="font-semibold truncate">{sub.name}</h3>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {sub.id}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => (pickerExpanded.value = true)}
              className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
            >
              Change
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Explicit selected state when 2+ subs exist
  if (value && selected.value && !pickerExpanded.value) {
    return (
      <div className="space-y-2">
        <Label>{labelText}</Label>
        <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CreditCard className="size-5 text-violet-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold truncate">
                  {selected.value.name}
                </h3>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {selected.value.id}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                pickerExpanded.value = true;
                onChange("");
              }}
              className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
            >
              Change
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Grid
  return (
    <div className="space-y-2">
      <Label>{labelText}</Label>
      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1"
        role="listbox"
        aria-label="Lago subscriptions"
      >
        {filtered.value.map((sub) => (
          <button
            key={sub.id}
            type="button"
            role="option"
            aria-selected={value === sub.id}
            onClick={() => {
              onChange(sub.id);
              pickerExpanded.value = false;
            }}
            className="text-left border-2 border-border hover:border-violet-500/70 rounded-lg p-3 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <div className="flex items-start gap-3">
              <CreditCard className="size-4 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate">{sub.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                  {sub.id}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
