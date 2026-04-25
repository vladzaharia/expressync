import { useSignal } from "@preact/signals";
import { useCallback } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Filter, X } from "lucide-preact";
import { clientNavigate } from "@/src/lib/nav.ts";

export interface WebhookFilterState {
  type: string;
  status: string; // "", pending, processed, failed, skipped
  customer: string;
  subscription: string;
  start: string;
  end: string;
  notificationFired: "any" | "true" | "false";
}

interface Props {
  initial: WebhookFilterState;
}

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "pending", label: "Pending" },
  { value: "processed", label: "Processed" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped (breaker open)" },
];

const COMMON_TYPES = [
  "invoice.created",
  "invoice.finalized",
  "invoice.voided",
  "invoice.payment_status_updated",
  "invoice.generated",
  "invoice.drafted",
  "customer.created",
  "customer.updated",
  "subscription.started",
  "subscription.terminated",
  "wallet_transaction.created",
  "wallet_transaction.payment_failure",
  "alert.triggered",
  "credit_note.created",
  "payment_request.created",
  "fee.created",
];

/**
 * Filter bar for /admin/webhook-events.
 *
 * All filter state is reflected in the URL query string so the page is
 * shareable and the server-rendered state always matches the client inputs.
 * Applying filters triggers a full-page navigation (this keeps the SSR
 * loader authoritative — no client-side cache divergence).
 */
export default function WebhookEventFilters({ initial }: Props) {
  const type = useSignal(initial.type);
  const status = useSignal(initial.status);
  const customer = useSignal(initial.customer);
  const subscription = useSignal(initial.subscription);
  const start = useSignal(initial.start);
  const end = useSignal(initial.end);
  const notificationFired = useSignal<WebhookFilterState["notificationFired"]>(
    initial.notificationFired,
  );

  const apply = useCallback(() => {
    const qs = new URLSearchParams();
    if (type.value) qs.set("type", type.value);
    if (status.value) qs.set("status", status.value);
    if (customer.value) qs.set("customer", customer.value);
    if (subscription.value) qs.set("subscription", subscription.value);
    if (start.value) qs.set("start", start.value);
    if (end.value) qs.set("end", end.value);
    if (notificationFired.value === "true") {
      qs.set("notification_fired", "1");
    } else if (notificationFired.value === "false") {
      qs.set("notification_fired", "0");
    }
    const suffix = qs.toString();
    clientNavigate(
      suffix ? `/admin/webhook-events?${suffix}` : `/admin/webhook-events`,
    );
  }, [type, status, customer, subscription, start, end, notificationFired]);

  const reset = useCallback(() => {
    clientNavigate(`/admin/webhook-events`);
  }, []);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label
            htmlFor="webhook-filter-type"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Event type
          </Label>
          <Input
            id="webhook-filter-type"
            list="webhook-type-options"
            value={type.value}
            placeholder="e.g. invoice.created"
            onInput={(e) => {
              type.value = (e.target as HTMLInputElement).value;
            }}
          />
          <datalist id="webhook-type-options">
            {COMMON_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="webhook-filter-status"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Status
          </Label>
          <select
            id="webhook-filter-status"
            value={status.value}
            onChange={(e) => {
              status.value = (e.target as HTMLSelectElement).value;
            }}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring outline-none"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="webhook-filter-customer"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Customer (external id)
          </Label>
          <Input
            id="webhook-filter-customer"
            value={customer.value}
            placeholder="partial match"
            onInput={(e) => {
              customer.value = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="webhook-filter-subscription"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Subscription (external id)
          </Label>
          <Input
            id="webhook-filter-subscription"
            value={subscription.value}
            placeholder="partial match"
            onInput={(e) => {
              subscription.value = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="webhook-filter-start"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Received from
          </Label>
          <Input
            id="webhook-filter-start"
            type="date"
            value={start.value}
            onInput={(e) => {
              start.value = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="webhook-filter-end"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Received to
          </Label>
          <Input
            id="webhook-filter-end"
            type="date"
            value={end.value}
            onInput={(e) => {
              end.value = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={notificationFired.value === "true"}
            onCheckedChange={(checked) => {
              notificationFired.value = checked === true ? "true" : "any";
            }}
          />
          <span>Only rows that fired a notification</span>
        </label>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="gap-1.5"
          >
            <X className="size-4" aria-hidden="true" />
            Reset
          </Button>
          <Button type="submit" size="sm" className="gap-1.5">
            <Filter className="size-4" aria-hidden="true" />
            Apply filters
          </Button>
        </div>
      </div>
    </form>
  );
}
