/**
 * Tag Linking summary card — the right-column aside on `/tags/[tagPk]`.
 *
 * Two states:
 *   1. Linked: customer + subscription summary + edit / external CTAs.
 *   2. Empty: large icon + "Not linked" + "Link to customer" CTA.
 *
 * Server-rendered.
 */

import { ExternalLink, Link2, Pencil } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface TagLinkingInfo {
  mappingId: number;
  /** External id passed to Lago as `external_customer_id`. */
  lagoCustomerExternalId: string | null;
  /** Lago internal UUID used to build dashboard URLs. */
  lagoCustomerLagoId: string | null;
  customerName: string | null;
  customerSlug: string | null;
  customerSequentialId: number | null;
  /** External id of the subscription (if the mapping names one). */
  lagoSubscriptionExternalId: string | null;
  /** Lago internal UUID used for subscription dashboard links. */
  lagoSubscriptionLagoId: string | null;
  subscriptionName: string | null;
  subscriptionPlanCode: string | null;
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  billingTier: string;
}

interface Props {
  tagPk: number;
  linking: TagLinkingInfo | null;
  /** Dashboard base URL for building Lago deep links. */
  lagoDashboardUrl: string;
  /** When true, we caught a Lago API error during load — surface a soft hint. */
  lagoFetchFailed: boolean;
  /** Optional hint message shown under the summary (e.g. "3 unlinked sessions"). */
  warnLine?: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusTone(status: string | null): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "pending":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "terminated":
    case "canceled":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function billingTierBadge(tier: string): {
  label: string;
  className: string;
} {
  switch (tier) {
    case "comped":
      return {
        label: "Comped",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      };
    case "standard":
    default:
      return {
        label: "Standard",
        className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
      };
  }
}

export function TagLinkingCard(
  { tagPk, linking, lagoDashboardUrl, lagoFetchFailed, warnLine }: Props,
) {
  if (!linking) {
    return (
      <SectionCard title="Linking" icon={Link2} accent="cyan">
        <div class="flex flex-col items-center gap-3 text-center py-4">
          <div
            class="flex size-14 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
            aria-hidden="true"
          >
            <Link2 class="h-7 w-7" />
          </div>
          <div>
            <p class="text-sm font-medium">Not linked</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Attach this tag to a Lago customer to bill its sessions.
            </p>
          </div>
          <a
            href={`/links/new?tagPk=${tagPk}`}
            class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Link2 class="h-4 w-4" aria-hidden="true" />
            Link to customer
          </a>
          {lagoFetchFailed
            ? (
              <p class="text-xs text-amber-600 dark:text-amber-400">
                Lago is unreachable — linking status may be stale.
              </p>
            )
            : null}
        </div>
      </SectionCard>
    );
  }

  const tier = billingTierBadge(linking.billingTier);
  const customerUrl = lagoDashboardUrl && linking.lagoCustomerLagoId
    ? `${lagoDashboardUrl}/customer/${linking.lagoCustomerLagoId}`
    : null;
  const subscriptionUrl = lagoDashboardUrl && linking.lagoCustomerLagoId &&
      linking.lagoSubscriptionLagoId
    ? `${lagoDashboardUrl}/customer/${linking.lagoCustomerLagoId}/subscription/${linking.lagoSubscriptionLagoId}/overview`
    : null;

  return (
    <SectionCard
      title="Linking"
      icon={Link2}
      accent="cyan"
      actions={
        <span
          class={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
            tier.className,
          )}
          title={`Billing tier: ${tier.label}`}
        >
          {tier.label}
        </span>
      }
    >
      <div class="space-y-4">
        {/* Customer block */}
        <div class="space-y-1">
          <div class="text-xs uppercase tracking-wide text-muted-foreground">
            Customer
          </div>
          <div class="text-sm font-medium">
            {linking.customerName ?? linking.lagoCustomerExternalId ?? "—"}
          </div>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {linking.customerSlug
              ? <code class="font-mono">{linking.customerSlug}</code>
              : null}
            {linking.customerSequentialId !== null
              ? <span>#{linking.customerSequentialId}</span>
              : null}
          </div>
          {lagoFetchFailed
            ? (
              <p class="text-xs text-amber-600 dark:text-amber-400">
                Lago is unreachable — customer details may be stale.
              </p>
            )
            : null}
        </div>

        {/* Subscription block */}
        <div class="space-y-1">
          <div class="text-xs uppercase tracking-wide text-muted-foreground">
            Subscription
          </div>
          {linking.subscriptionPlanCode
            ? (
              <>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium">
                    {linking.subscriptionName ?? linking.subscriptionPlanCode}
                  </span>
                  {linking.subscriptionStatus
                    ? (
                      <span
                        class={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          statusTone(linking.subscriptionStatus),
                        )}
                      >
                        {linking.subscriptionStatus}
                      </span>
                    )
                    : null}
                </div>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <code class="font-mono">{linking.subscriptionPlanCode}</code>
                  {linking.subscriptionCurrentPeriodEnd
                    ? (
                      <span>
                        ends {fmtDate(linking.subscriptionCurrentPeriodEnd)}
                      </span>
                    )
                    : null}
                </div>
              </>
            )
            : (
              <div class="text-sm text-muted-foreground">
                <Badge variant="outline" class="border-dashed">
                  No active subscription
                </Badge>
              </div>
            )}
        </div>

        {warnLine
          ? (
            <div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              {warnLine}
            </div>
          )
          : null}

        {/* CTAs */}
        <div class="flex flex-wrap gap-2 pt-1">
          <a
            href={`/links/${linking.mappingId}`}
            class="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
            Edit linking
          </a>
          {customerUrl
            ? (
              <a
                href={customerUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open customer in Lago (opens in new tab)"
                class="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
                Open in Lago
              </a>
            )
            : null}
        </div>
        {subscriptionUrl
          ? (
            <a
              href={subscriptionUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open subscription in Lago (opens in new tab)"
              class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
              Open subscription in Lago
            </a>
          )
          : null}
      </div>
    </SectionCard>
  );
}
