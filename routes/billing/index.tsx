/**
 * /billing — customer Billing landing.
 *
 * Polaris Track G3 — single page combining Subscription + Usage + Invoices.
 * SidebarLayout with the customer navigation, page accent = teal.
 *
 * Loader fetches three things (each tolerant of failure):
 *   1. Lago subscription via `lagoClient.getSubscriptions(externalCustomerId)`
 *   2. Lago current/previous/year usage via `lagoClient.getCurrentUsage`
 *      (legacy `previous` / `year` periods short-circuit to a placeholder)
 *   3. Customer invoice list via `lagoClient.listInvoices` (with status +
 *      date filters from URL)
 *
 * Layout (top-down):
 *   StatStrip [Open · Paid · This Period kWh · Total Spent]
 *     (Open / Paid cells double as ?status= shortcuts)
 *   Anchor sub-nav: "Subscription · Usage · Invoices"
 *   SectionCard "Subscription" #subscription
 *   SectionCard "Usage" #usage
 *   SectionCard "Invoices" #invoices
 *     [filter bar]
 *     [CustomerInvoicesTable]
 *     [EmptyState if zero]
 */

import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
import {
  StatStrip,
  type StatStripItem,
} from "../../components/shared/StatStrip.tsx";
import { EmptyState } from "../../components/shared/EmptyState.tsx";
import { BlurFade } from "../../components/magicui/blur-fade.tsx";
import { MoneyBadge } from "../../components/billing/MoneyBadge.tsx";
import { BillingPeriodSwitcher } from "../../components/shared/BillingPeriodSwitcher.tsx";
import type { BillingPeriod } from "../../components/shared/BillingPeriodSwitcher.tsx";
import SubscriptionHeroCard from "../../islands/customer/SubscriptionHeroCard.tsx";
import type { SubscriptionHeroData } from "../../islands/customer/SubscriptionHeroCard.tsx";
import UsageGaugeLive from "../../islands/customer/UsageGaugeLive.tsx";
import CustomerInvoicesTable from "../../islands/customer/CustomerInvoicesTable.tsx";
import CustomerInvoiceFilterBar from "../../islands/customer/CustomerInvoiceFilterBar.tsx";
import type { CustomerInvoiceFilter } from "../../islands/customer/CustomerInvoiceFilterBar.tsx";
import {
  Bolt,
  FileText,
  Gauge,
  Receipt,
  Wallet,
  WalletCards,
} from "lucide-preact";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import {
  deriveInvoiceUiStatus,
  type InvoiceListDTO,
  toInvoiceListDTO,
} from "../../src/lib/invoice-ui.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { and, eq, isNotNull, ne } from "drizzle-orm";

const log = logger.child("CustomerBillingPage");

interface BillingPageData {
  subscription: SubscriptionHeroData | null;
  usage: {
    period: BillingPeriod;
    valueKwh: number;
    /** Optional cap to drive the gauge ratio (null when no plan cap exposed). */
    capKwh: number | null;
    supported: boolean;
    currency: string;
    totalSpentCents: number;
  };
  invoices: {
    rows: InvoiceListDTO[];
    totalCount: number;
    openCount: number;
    paidCount: number;
    totalSpentCents: number;
  };
  filters: {
    status: CustomerInvoiceFilter[];
    from: string;
    to: string;
  };
  scopeIsActive: boolean;
  scopeMappingIds: number[];
  hasLagoLink: boolean;
  currency: string;
}

const ALLOWED_PERIODS: BillingPeriod[] = ["current", "previous", "year"];
const ALLOWED_STATUS: CustomerInvoiceFilter[] = ["open", "paid", "voided"];

/** Map URL `status` set to Lago `status` + `payment_status` query lists. */
function customerStatusToLago(filters: CustomerInvoiceFilter[]): {
  lagoStatus: string[];
  lagoPaymentStatus: string[];
} {
  const lagoStatus = new Set<string>();
  const lagoPaymentStatus = new Set<string>();
  for (const f of filters) {
    switch (f) {
      case "open":
        // "Open" in customer parlance = finalized AND not paid yet.
        lagoStatus.add("finalized");
        lagoPaymentStatus.add("pending");
        lagoPaymentStatus.add("failed");
        break;
      case "paid":
        lagoStatus.add("finalized");
        lagoPaymentStatus.add("succeeded");
        break;
      case "voided":
        lagoStatus.add("voided");
        break;
    }
  }
  return {
    lagoStatus: [...lagoStatus],
    lagoPaymentStatus: [...lagoPaymentStatus],
  };
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const periodParam = url.searchParams.get("period");
    const period: BillingPeriod = ALLOWED_PERIODS.includes(
        periodParam as BillingPeriod,
      )
      ? (periodParam as BillingPeriod)
      : "current";

    const statusParams = url.searchParams.getAll("status").filter(
      (s): s is CustomerInvoiceFilter =>
        ALLOWED_STATUS.includes(s as CustomerInvoiceFilter),
    );
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";

    const scope = await resolveCustomerScope(ctx);
    const hasLagoLink = scope.lagoCustomerExternalId !== null;

    let subscription: SubscriptionHeroData | null = null;
    let currency = "EUR";
    let valueKwh = 0;
    // No plan cap is exposed in the current Lago payload — kept as a
    // future hook so the gauge can render a "x of y kWh" ratio later.
    const capKwh: number | null = null;
    let usageSupported = true;
    let invoicesRows: InvoiceListDTO[] = [];
    let invoicesTotal = 0;
    let openCount = 0;
    let paidCount = 0;
    let totalSpentCents = 0;
    let usageTotalSpentCents = 0;

    if (hasLagoLink) {
      // Fetch subscription summary.
      try {
        const { subscriptions } = await lagoClient.getSubscriptions(
          scope.lagoCustomerExternalId!,
        );
        const active = subscriptions.find((s) =>
          s.status === "active" || s.status === "pending"
        ) ?? subscriptions[0] ?? null;
        if (active) {
          subscription = {
            name: active.name,
            planCode: active.plan_code,
            billingTime: active.billing_time,
            // Lago's subscription payload doesn't carry a "next invoice
            // date" directly — best signal is the current billing period
            // ending date.
            nextInvoiceDateIso: active.current_billing_period_ending_at ?? null,
            // Estimate is not in the basic subscription payload; fetched
            // separately in a follow-up.
            nextInvoiceEstimateCents: null,
            currency,
            status: active.status,
          };
        }
      } catch (err) {
        log.warn(
          "Failed to fetch subscription for billing page",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }

      // Fetch current usage when period === "current"; previous/year are
      // not yet supported by the underlying API.
      if (period === "current" && subscription) {
        try {
          // Resolve the active subscription external id via mapping.
          const mappingRows = await db
            .select({
              subscriptionExternalId:
                schema.userMappings.lagoSubscriptionExternalId,
            })
            .from(schema.userMappings)
            .where(
              and(
                eq(
                  schema.userMappings.lagoCustomerExternalId,
                  scope.lagoCustomerExternalId!,
                ),
                eq(schema.userMappings.isActive, true),
                isNotNull(schema.userMappings.lagoSubscriptionExternalId),
                ne(schema.userMappings.lagoSubscriptionExternalId, ""),
              ),
            );
          const subId = mappingRows[0]?.subscriptionExternalId ?? null;
          if (subId) {
            const usage = await lagoClient.getCurrentUsage(
              scope.lagoCustomerExternalId!,
              subId,
            );
            currency = usage.currency || currency;
            usageTotalSpentCents = usage.total_amount_cents;
            // Aggregate the energy units across charges_usage entries.
            for (const u of usage.charges_usage) {
              const unitsNum = parseFloat(u.units);
              if (Number.isFinite(unitsNum)) valueKwh += unitsNum;
            }
          }
        } catch (err) {
          log.warn(
            "Failed to fetch usage for billing page",
            { error: err instanceof Error ? err.message : String(err) },
          );
        }
      } else if (period !== "current") {
        usageSupported = false;
      }

      // Fetch invoices with active filters applied.
      try {
        const { lagoStatus, lagoPaymentStatus } = customerStatusToLago(
          statusParams,
        );
        const list = await lagoClient.listInvoices({
          externalCustomerId: scope.lagoCustomerExternalId!,
          page: 1,
          perPage: 25,
          status: lagoStatus.length > 0 ? lagoStatus : undefined,
          paymentStatus: lagoPaymentStatus.length > 0
            ? lagoPaymentStatus
            : undefined,
          issuingDateFrom: from || undefined,
          issuingDateTo: to || undefined,
        });
        invoicesRows = list.invoices.map(toInvoiceListDTO);
        invoicesTotal = list.meta.total_count;
        if (list.invoices[0]) currency = list.invoices[0].currency;
      } catch (err) {
        log.warn(
          "Failed to fetch invoices for billing page",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }

      // Compute Open / Paid stat counts from a separate unfiltered fetch
      // so the StatStrip stays meaningful regardless of UI filters.
      try {
        const stats = await lagoClient.listInvoices({
          externalCustomerId: scope.lagoCustomerExternalId!,
          page: 1,
          perPage: 100,
        });
        for (const inv of stats.invoices) {
          const ui = deriveInvoiceUiStatus({
            status: inv.status,
            payment_status: inv.payment_status,
            payment_overdue: inv.payment_overdue,
          });
          if (ui === "paid") {
            paidCount += 1;
            totalSpentCents += inv.total_amount_cents;
          } else if (
            ui === "finalized" || ui === "overdue" || ui === "pending" ||
            ui === "failed"
          ) {
            openCount += 1;
          }
        }
      } catch (err) {
        log.warn(
          "Failed to fetch stat counts for billing page",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    return {
      data: {
        subscription,
        usage: {
          period,
          valueKwh,
          capKwh,
          supported: usageSupported,
          currency,
          totalSpentCents: usageTotalSpentCents,
        },
        invoices: {
          rows: invoicesRows,
          totalCount: invoicesTotal,
          openCount,
          paidCount,
          totalSpentCents,
        },
        filters: { status: statusParams, from, to },
        scopeIsActive: scope.isActive,
        scopeMappingIds: scope.mappingIds,
        hasLagoLink,
        currency,
      } satisfies BillingPageData,
    };
  },
});

function SubNav({ activeStatus }: { activeStatus: string[] }) {
  // The sub-nav doubles as a quick anchor jump. We keep it simple — three
  // anchors hashed to the SectionCard ids below.
  return (
    <nav
      className="-mx-1 flex flex-wrap gap-1 text-sm"
      aria-label="Billing sections"
    >
      {[
        { href: "#subscription", label: "Subscription" },
        { href: "#usage", label: "Usage" },
        { href: "#invoices", label: "Invoices" },
      ].map((entry) => (
        <a
          key={entry.href}
          href={entry.href}
          className="rounded-md px-3 py-1 text-muted-foreground hover:bg-teal-500/10 hover:text-teal-700 dark:hover:text-teal-300"
        >
          {entry.label}
        </a>
      ))}
      {activeStatus.length > 0 && (
        <span className="ml-auto text-xs text-muted-foreground">
          Filtering by {activeStatus.join(", ")}
        </span>
      )}
    </nav>
  );
}

export default define.page<typeof handler>(function BillingIndexPage(
  { data, url, state },
) {
  const periodLabel = data.usage.period === "current"
    ? "this month"
    : data.usage.period === "previous"
    ? "last month"
    : "this year";

  const stats: StatStripItem[] = [
    {
      key: "open",
      label: `Open · ${data.invoices.openCount}`,
      value: data.invoices.openCount,
      icon: WalletCards,
      href: "/billing?status=open#invoices",
      active: data.filters.status.includes("open"),
      disabledWhenZero: true,
    },
    {
      key: "paid",
      label: `Paid · ${data.invoices.paidCount}`,
      value: data.invoices.paidCount,
      icon: FileText,
      href: "/billing?status=paid#invoices",
      active: data.filters.status.includes("paid"),
      tone: "emerald",
    },
    {
      key: "kwh",
      label: `kWh ${periodLabel}`,
      value: `${
        data.usage.valueKwh.toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })
      } kWh`,
      icon: Bolt,
    },
    {
      key: "spent",
      label: "Total spent",
      value: (
        <MoneyBadge
          cents={data.invoices.totalSpentCents}
          currency={data.currency}
        />
      ),
      icon: Wallet,
    },
  ];

  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      role="customer"
      accentColor="teal"
    >
      <PageCard
        title="Billing"
        description={data.hasLagoLink
          ? "Subscription, usage, and invoices."
          : "No billing account on file. Contact your operator to provision a plan."}
        colorScheme="teal"
      >
        <div className="flex flex-col gap-6">
          <BlurFade direction="up" duration={0.35}>
            <StatStrip accent="teal" items={stats} />
          </BlurFade>

          <SubNav activeStatus={data.filters.status} />

          <div id="subscription">
            <SectionCard title="Subscription" icon={Wallet} accent="teal">
              <SubscriptionHeroCard subscription={data.subscription} />
            </SectionCard>
          </div>

          <div id="usage">
            <SectionCard
              title="Usage"
              icon={Gauge}
              accent="teal"
              actions={
                <BillingPeriodSwitcher
                  value={data.usage.period}
                  basePath="/billing"
                />
              }
            >
              {data.usage.supported
                ? (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <UsageGaugeLive
                      initialValueKwh={data.usage.valueKwh}
                      capKwh={data.usage.capKwh}
                      caption={periodLabel}
                      accent="teal"
                      mappingIds={data.scopeMappingIds}
                    />
                    {data.usage.totalSpentCents > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Estimated cost {periodLabel}{" "}
                        <MoneyBadge
                          cents={data.usage.totalSpentCents}
                          currency={data.usage.currency}
                        />
                      </p>
                    )}
                  </div>
                )
                : (
                  <p className="text-sm text-muted-foreground">
                    Historical usage isn't available yet. We'll surface it once
                    finalized invoices land for the selected period.
                  </p>
                )}
            </SectionCard>
          </div>

          <div id="invoices">
            <SectionCard title="Invoices" icon={Receipt} accent="teal">
              <div className="flex flex-col gap-4">
                <CustomerInvoiceFilterBar initial={data.filters} />
                {data.invoices.rows.length === 0
                  ? (
                    <EmptyState
                      icon={Receipt}
                      accent="teal"
                      title="No invoices to show"
                      description={data.filters.status.length > 0 ||
                          data.filters.from ||
                          data.filters.to
                        ? "Try clearing the filters or widening the date range."
                        : "Invoices appear here as your operator finalizes them."}
                      primaryAction={data.filters.status.length > 0 ||
                          data.filters.from || data.filters.to
                        ? {
                          label: "Reset filters",
                          href: "/billing#invoices",
                        }
                        : undefined}
                    />
                  )
                  : (
                    <CustomerInvoicesTable
                      invoices={data.invoices.rows}
                      totalCount={data.invoices.totalCount}
                      fetchUrl="/api/customer/invoices"
                      fetchParams={{
                        ...(data.filters.from
                          ? { from: data.filters.from }
                          : {}),
                        ...(data.filters.to ? { to: data.filters.to } : {}),
                      }}
                    />
                  )}
              </div>
            </SectionCard>
          </div>
        </div>
      </PageCard>
    </SidebarLayout>
  );
});
