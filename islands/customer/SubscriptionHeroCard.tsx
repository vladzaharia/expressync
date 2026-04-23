/**
 * SubscriptionHeroCard — customer Billing subscription summary.
 *
 * Polaris Track G — renders a 2x2 MetricTile grid showing the customer's
 * Lago subscription at a glance: plan name, billing interval, next invoice
 * date, and (when available) next-invoice estimate. Reads from the loader's
 * pre-fetched subscription DTO so the island ships zero network calls in
 * the common path.
 *
 * Empty-scope and no-subscription cases render a single muted "No
 * subscription on file" tile rather than a four-tile grid full of em-dashes.
 *
 * Server-render-friendly — this island has no client effects so it
 * hydrates immediately and stays static. Shipped as an island only because
 * the parent page composes it inside other islands; converting to a plain
 * component is acceptable too.
 */

import { Calendar, Clock, Receipt, Wallet } from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { MoneyBadge } from "@/components/billing/MoneyBadge.tsx";

export interface SubscriptionHeroData {
  /** Display name for the plan (Lago `subscription.name` or `plan_code` fallback). */
  name: string | null;
  /** Plan code, used as the secondary label. */
  planCode: string | null;
  /** Billing cycle: "calendar" or "anniversary" per Lago. */
  billingTime: "calendar" | "anniversary" | null;
  /** ISO of the next invoice date — null if Lago doesn't expose it. */
  nextInvoiceDateIso: string | null;
  /** Cents estimate of the next invoice if available. */
  nextInvoiceEstimateCents: number | null;
  currency: string;
  /** Lago subscription status — "active" / "pending" / "terminated" / "canceled". */
  status: string | null;
}

interface Props {
  subscription: SubscriptionHeroData | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBillingInterval(b: SubscriptionHeroData["billingTime"]): string {
  if (b === "calendar") return "Monthly · calendar";
  if (b === "anniversary") return "Monthly · anniversary";
  return "—";
}

export default function SubscriptionHeroCard({ subscription }: Props) {
  if (!subscription) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm font-medium text-foreground">
          No subscription on file
        </p>
        <p className="text-xs text-muted-foreground">
          Contact your operator to provision a billing plan.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MetricTile
        icon={Wallet}
        label="Plan"
        value={subscription.name ?? subscription.planCode ?? "—"}
        sublabel={subscription.planCode ?? undefined}
        accent="teal"
      />
      <MetricTile
        icon={Clock}
        label="Billing"
        value={formatBillingInterval(subscription.billingTime)}
        sublabel={subscription.status ?? undefined}
        accent="teal"
      />
      <MetricTile
        icon={Calendar}
        label="Next invoice"
        value={formatDate(subscription.nextInvoiceDateIso)}
        accent="teal"
      />
      <MetricTile
        icon={Receipt}
        label="Estimate"
        value={subscription.nextInvoiceEstimateCents !== null
          ? (
            <MoneyBadge
              cents={subscription.nextInvoiceEstimateCents}
              currency={subscription.currency}
            />
          )
          : "—"}
        accent="teal"
      />
    </div>
  );
}
