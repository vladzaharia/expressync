/**
 * /billing — customer Billing landing.
 *
 * IA (top-down, inside one PageCard, accent=blue):
 *   StatStrip [ Amount due · Next due · Paid last 30d · kWh this month ]
 *   SectionCard "Overview"        → BillingOverviewCard (pay-now pill or paid-up tick)
 *   SectionCard "Plan & Usage"    → PeriodUsageChart + PlanInfoCard (1fr · 1fr on lg)
 *   SectionCard "Wallet"          → CustomerWalletSection (conditional)
 *   SectionCard "Invoices"        → filter bar + CustomerInvoicesTable + EmptyState
 */

import { and, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
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
import {
  BillingOverviewCard,
  type BillingOverviewData,
} from "../../components/customer/BillingOverviewCard.tsx";
import { type PlanInfo } from "../../components/customer/PlanInfoCard.tsx";
import { PeriodBreakdownCard } from "../../components/customer/PeriodBreakdownCard.tsx";
import PeriodUsageChart, {
  type UsageDayPoint,
} from "../../islands/customer/PeriodUsageChart.tsx";
import CustomerInvoicesTable from "../../islands/customer/CustomerInvoicesTable.tsx";
import CustomerInvoiceFilterBar from "../../islands/customer/CustomerInvoiceFilterBar.tsx";
import type { CustomerInvoiceFilter } from "../../islands/customer/CustomerInvoiceFilterBar.tsx";
import CustomerWalletSection, {
  type WalletData,
} from "../../islands/customer/CustomerWalletSection.tsx";
import HeroSessionCard from "../../islands/customer/HeroSessionCard.tsx";
import {
  BatteryCharging,
  Bolt,
  CalendarClock,
  CircleDollarSign,
  Gauge,
  Receipt,
  Wallet,
} from "lucide-preact";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import {
  type InvoiceListDTO,
  toInvoiceListDTO,
} from "../../src/lib/invoice-ui.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import {
  currencySymbolFor,
  derivePlanInfo,
  enumerateDays,
  localDayKey,
  periodWindow,
} from "../../src/lib/billing-derive.ts";
import { config } from "../../src/lib/config.ts";

const log = logger.child("CustomerBillingPage");

interface BillingPageData {
  overview: BillingOverviewData;
  plan: PlanInfo | null;
  dailyUsage: UsageDayPoint[];
  periodLabel: string;
  wallet: WalletData | null;
  invoices: {
    rows: InvoiceListDTO[];
    totalCount: number;
    paidLast30dCents: number;
  };
  filters: {
    status: CustomerInvoiceFilter[];
    from: string;
    to: string;
  };
  hasLagoLink: boolean;
  currency: string;
  operatorEmail?: string;
  /**
   * Lago hosted customer-portal URL. Resolved server-side (best-effort)
   * from `lagoClient.getCustomerPortalUrl`. Customers click "Manage in
   * billing portal" to update payment methods, change plan, etc. — flows
   * we don't implement natively. Null when Lago is unreachable or the
   * customer has no Lago link.
   */
  billingPortalUrl: string | null;
  /**
   * In-progress charging session for this customer, if any. When present
   * the page renders a "Currently charging" SectionCard with a live
   * `LiveSessionCard` near the top.
   */
  activeSession: {
    steveTransactionId: number;
    chargeBoxId: string | null;
    friendlyName?: string | null;
    connectorId: number | null;
    connectorType: string | null;
    initialKwh: number;
    startedAt: string | null;
    tagDisplayName: string | null;
    estimatedCost?: number;
    currencySymbol?: string;
    tariffPerKwh?: number;
    walletBalanceCents?: number;
    walletThresholdCents?: number;
  } | null;
}

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
    // Current only for now — previous/year not yet wired.
    const period: BillingPeriod = "current";

    const statusParams = url.searchParams.getAll("status").filter(
      (s): s is CustomerInvoiceFilter =>
        ALLOWED_STATUS.includes(s as CustomerInvoiceFilter),
    );
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";

    const scope = await resolveCustomerScope(ctx);
    const hasLagoLink = scope.lagoCustomerExternalId !== null;

    let currency = "EUR";
    let planInfo: PlanInfo | null = null;
    let invoicesRows: InvoiceListDTO[] = [];
    let invoicesTotal = 0;

    // Invoice aggregates
    let openCents = 0;
    let overdueCents = 0;
    let failedCount = 0;
    let paidLast30dCents = 0;
    let nextDueDateIso: string | null = null;
    let nextInvoiceDateIso: string | null = null;
    let nextInvoiceEstimateCents: number | null = null;

    // ── Usage series for the current period (DB-backed) ───────────────
    const { from: periodFrom, to: periodTo, label: periodLabel } = periodWindow(
      period,
    );
    let usageValueKwh = 0;
    const dayBuckets = new Map<string, number>();
    for (const d of enumerateDays(periodFrom, periodTo)) dayBuckets.set(d, 0);
    if (scope.mappingIds.length > 0) {
      try {
        const rows = await db
          .select({
            syncedAt: schema.syncedTransactionEvents.syncedAt,
            kwhDelta: schema.syncedTransactionEvents.kwhDelta,
          })
          .from(schema.syncedTransactionEvents)
          .where(
            and(
              inArray(
                schema.syncedTransactionEvents.userMappingId,
                scope.mappingIds,
              ),
              gte(schema.syncedTransactionEvents.syncedAt, periodFrom),
              lt(schema.syncedTransactionEvents.syncedAt, periodTo),
            ),
          );
        for (const r of rows) {
          const kwh = Number(r.kwhDelta ?? 0);
          usageValueKwh += kwh;
          if (r.syncedAt) {
            const key = localDayKey(new Date(r.syncedAt));
            dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + kwh);
          }
        }
      } catch (err) {
        log.warn("Failed to fetch daily usage for billing page", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const dailyUsage: UsageDayPoint[] = [...dayBuckets.entries()].map((
      [date, kwh],
    ) => ({ date, kwh: Number(kwh.toFixed(3)) }));

    let wallet: WalletData | null = null;

    // ── Active charging session (live tile) ───────────────────────────
    // Mirrors the dashboard active-session lookup (routes/index.tsx) so
    // the billing page can show the same live "Currently charging" tile
    // up top. Best-effort: failures fall back to no card rendered.
    let activeSessionData: BillingPageData["activeSession"] = null;
    if (scope.mappingIds.length > 0) {
      try {
        const [active] = await db
          .select({
            steveTransactionId:
              schema.syncedTransactionEvents.steveTransactionId,
            syncedAt: schema.syncedTransactionEvents.syncedAt,
            totalKwhBilled: schema.transactionSyncState.totalKwhBilled,
            isFinalized: schema.transactionSyncState.isFinalized,
            tagDisplayName: schema.userMappings.displayName,
          })
          .from(schema.syncedTransactionEvents)
          .leftJoin(
            schema.transactionSyncState,
            eq(
              schema.syncedTransactionEvents.steveTransactionId,
              schema.transactionSyncState.steveTransactionId,
            ),
          )
          .leftJoin(
            schema.userMappings,
            eq(
              schema.syncedTransactionEvents.userMappingId,
              schema.userMappings.id,
            ),
          )
          .where(
            and(
              inArray(
                schema.syncedTransactionEvents.userMappingId,
                scope.mappingIds,
              ),
              eq(schema.transactionSyncState.isFinalized, false),
            ),
          )
          .orderBy(schema.syncedTransactionEvents.syncedAt)
          .limit(1);
        if (active) {
          const initialKwh = Number(active.totalKwhBilled ?? 0);
          activeSessionData = {
            steveTransactionId: active.steveTransactionId,
            chargeBoxId: null,
            friendlyName: null,
            connectorId: null,
            connectorType: null,
            initialKwh,
            startedAt: active.syncedAt ? active.syncedAt.toISOString() : null,
            tagDisplayName: active.tagDisplayName ?? null,
          };
        }
      } catch (err) {
        log.warn("billing page active-session lookup failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (hasLagoLink) {
      const extCustomerId = scope.lagoCustomerExternalId!;

      // Resolve subscription id for plan + estimate fetches.
      let subId: string | null = null;
      try {
        const mappingRows = await db
          .select({
            subscriptionExternalId:
              schema.userMappings.lagoSubscriptionExternalId,
          })
          .from(schema.userMappings)
          .where(
            and(
              eq(schema.userMappings.lagoCustomerExternalId, extCustomerId),
              eq(schema.userMappings.isActive, true),
              isNotNull(schema.userMappings.lagoSubscriptionExternalId),
              ne(schema.userMappings.lagoSubscriptionExternalId, ""),
            ),
          );
        subId = mappingRows[0]?.subscriptionExternalId ?? null;
      } catch (err) {
        log.warn("Failed to resolve subscription for billing page", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Subscription name (for plan label) + current usage estimate.
      let subscriptionName: string | null = null;
      if (subId) {
        try {
          const [{ subscription }, usage] = await Promise.all([
            lagoClient.getSubscription(subId).catch(
              () => ({ subscription: null } as const),
            ),
            lagoClient.getCurrentUsage(extCustomerId, subId).catch(() => null),
          ]);
          if (subscription) {
            subscriptionName = subscription.name;
            nextInvoiceDateIso =
              subscription.current_billing_period_ending_at ?? null;
          }
          if (usage) {
            currency = usage.currency || currency;
            nextInvoiceEstimateCents = usage.total_amount_cents;
          }
          const planCode = subscription?.plan_code ?? null;
          if (planCode) {
            const planRaw = await lagoClient.getPlan(planCode).catch(() => null);
            if (planRaw) {
              planInfo = derivePlanInfo(
                planRaw as unknown as Record<string, unknown>,
                usageValueKwh,
                currencySymbolFor(currency),
              );
              if (planInfo && subscriptionName) planInfo.name = subscriptionName;
            }
          }
        } catch (err) {
          log.warn("Failed to fetch plan/usage for billing page", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Invoices list (filtered).
      try {
        const { lagoStatus, lagoPaymentStatus } = customerStatusToLago(
          statusParams,
        );
        const list = await lagoClient.listInvoices({
          externalCustomerId: extCustomerId,
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
        log.warn("Failed to fetch invoices for billing page", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Unfiltered aggregate sweep for the overview + stats.
      try {
        const stats = await lagoClient.listInvoices({
          externalCustomerId: extCustomerId,
          page: 1,
          perPage: 100,
        });
        const now = Date.now();
        const thirtyDaysAgoMs = now - 30 * 24 * 60 * 60 * 1000;
        for (const inv of stats.invoices) {
          const isFinalized = inv.status === "finalized";
          if (!isFinalized) continue;
          const paid = inv.payment_status === "succeeded";
          if (paid) {
            const issued = inv.issuing_date
              ? new Date(inv.issuing_date).getTime()
              : 0;
            if (issued >= thirtyDaysAgoMs) {
              paidLast30dCents += inv.total_amount_cents;
            }
          } else {
            openCents += inv.total_amount_cents;
            if (inv.payment_overdue) {
              overdueCents += inv.total_amount_cents;
            }
            if (inv.payment_status === "failed") failedCount += 1;
            if (inv.payment_due_date) {
              if (
                nextDueDateIso === null ||
                new Date(inv.payment_due_date) < new Date(nextDueDateIso)
              ) {
                nextDueDateIso = inv.payment_due_date;
              }
            }
          }
        }
      } catch (err) {
        log.warn("Failed to fetch invoice aggregates for billing page", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Wallet (optional, tolerant of failure).
      try {
        const { wallets } = await lagoClient.listWalletsForCustomer(
          extCustomerId,
        );
        const active = wallets.find((w) => w.status === "active") ?? wallets[0];
        if (active) {
          const balanceCents = typeof active.balance_cents === "number"
            ? active.balance_cents
            : Math.round(parseFloat(active.credits_balance ?? "0") * 100);
          const consumedCents = Math.round(
            parseFloat(active.consumed_credits ?? "0") *
              parseFloat(active.rate_amount ?? "1") * 100,
          );
          let txs: WalletData["transactions"] = [];
          try {
            const { wallet_transactions } = await lagoClient
              .listWalletTransactions(active.lago_id, {
                page: 1,
                perPage: 5,
              });
            txs = wallet_transactions.map((t) => ({
              id: t.lago_id,
              dateIso: t.settled_at ?? t.created_at ?? "",
              cents: Math.round(parseFloat(t.amount ?? "0") * 100),
              type: t.transaction_type ?? "inbound",
              status: t.status ?? "",
            }));
          } catch (err) {
            log.warn("Failed to fetch wallet transactions for billing page", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          wallet = {
            balanceCents: Number.isFinite(balanceCents) ? balanceCents : 0,
            consumedCents: Number.isFinite(consumedCents) ? consumedCents : 0,
            lastTopUpIso: active.last_balance_sync_at ?? null,
            currency: active.currency,
            transactions: txs,
          };
        }
      } catch (err) {
        log.warn("Failed to fetch wallet for billing page", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const paidUp = openCents === 0 && failedCount === 0;
    const overview: BillingOverviewData = {
      openCents,
      overdueCents,
      failedCount,
      nextInvoiceDateIso,
      nextInvoiceEstimateCents,
      currency,
      paidUp,
      nextDueDateIso,
      operatorEmail: config.OPERATOR_CONTACT_EMAIL || undefined,
    };

    // Enrich the active session with currency + tariff + wallet figures
    // pulled from Lago above, so `LiveSessionCard` can render running cost
    // and a wallet tile without an extra round-trip.
    if (activeSessionData) {
      activeSessionData.currencySymbol = currencySymbolFor(currency);
      const perKwh = planInfo?.perKwhCharge != null
        ? planInfo.perKwhCharge
        : undefined;
      if (perKwh && perKwh > 0) {
        activeSessionData.tariffPerKwh = perKwh;
        activeSessionData.estimatedCost =
          Number((activeSessionData.initialKwh * perKwh).toFixed(2));
      }
      if (wallet) {
        activeSessionData.walletBalanceCents = wallet.balanceCents;
      }
    }

    // Resolve Lago hosted-portal URL (best-effort). Lago expires these
    // signed URLs after a short window so we MUST resolve per request,
    // not cache. A failure here just hides the "Manage in billing portal"
    // button.
    let billingPortalUrl: string | null = null;
    if (hasLagoLink && scope.lagoCustomerExternalId) {
      try {
        const resp = await lagoClient.getCustomerPortalUrl(
          scope.lagoCustomerExternalId,
        );
        billingPortalUrl = resp.customer.portal_url ?? null;
      } catch (err) {
        log.warn("Failed to resolve Lago portal URL; hiding link", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      data: {
        overview,
        plan: planInfo,
        dailyUsage,
        periodLabel,
        wallet,
        invoices: {
          rows: invoicesRows,
          totalCount: invoicesTotal,
          paidLast30dCents,
        },
        filters: { status: statusParams, from, to },
        hasLagoLink,
        currency,
        operatorEmail: config.OPERATOR_CONTACT_EMAIL || undefined,
        activeSession: activeSessionData,
        billingPortalUrl,
      } satisfies BillingPageData,
    };
  },
});

export default define.page<typeof handler>(function BillingIndexPage(
  { data, url, state },
) {
  // No-Lago-link empty state — dedicated body in place of everything else.
  if (!data.hasLagoLink) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        role="customer"
        accentColor="blue"
      >
        <PageCard
          title="Billing"
          description="Your plan, usage, and invoices."
          colorScheme="blue"
        >
          <EmptyState
            icon={Receipt}
            accent="blue"
            title="No billing account on file"
            description="Contact your operator to provision a plan and unlock billing."
            primaryAction={data.operatorEmail
              ? {
                label: "Contact operator",
                href: `mailto:${data.operatorEmail}`,
              }
              : undefined}
          />
        </PageCard>
      </SidebarLayout>
    );
  }

  const overdueCellTone = data.overview.overdueCents > 0
    ? "amber"
    : undefined;

  const stats: StatStripItem[] = [
    {
      key: "due",
      label: "Amount due",
      value: (
        <MoneyBadge
          cents={data.overview.openCents}
          currency={data.currency}
          muted={data.overview.openCents === 0}
        />
      ),
      icon: CircleDollarSign,
      tone: overdueCellTone,
      href: "/billing?status=open#invoices",
      active: data.filters.status.includes("open"),
      disabledWhenZero: data.overview.openCents === 0,
    },
    {
      key: "next-due",
      label: "Next due",
      value: data.overview.nextDueDateIso
        ? new Date(data.overview.nextDueDateIso).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
        : "—",
      icon: CalendarClock,
    },
    {
      key: "paid30",
      label: "Paid last 30d",
      value: (
        <MoneyBadge
          cents={data.invoices.paidLast30dCents}
          currency={data.currency}
          muted={data.invoices.paidLast30dCents === 0}
        />
      ),
      icon: Wallet,
      tone: "emerald",
      href: "/billing?status=paid#invoices",
      active: data.filters.status.includes("paid"),
    },
    {
      key: "kwh",
      label: `kWh · ${data.periodLabel}`,
      value: `${
        data.dailyUsage.reduce((a, p) => a + p.kwh, 0).toLocaleString(
          undefined,
          { maximumFractionDigits: 1 },
        )
      } kWh`,
      icon: Bolt,
    },
  ];

  const hasActiveFilters = data.filters.status.length > 0 ||
    data.filters.from !== "" || data.filters.to !== "";

  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      role="customer"
      accentColor="blue"
    >
      <PageCard
        title="Billing"
        description="Your plan, usage, and invoices."
        colorScheme="blue"
      >
        <div className="flex flex-col gap-6">
          <BlurFade direction="up" duration={0.35}>
            <StatStrip accent="blue" items={stats} />
          </BlurFade>

          {data.activeSession && (
            <SectionCard
              title="Currently charging"
              icon={BatteryCharging}
              accent="emerald"
              borderBeam
            >
              <HeroSessionCard
                session={{
                  steveTransactionId: data.activeSession.steveTransactionId,
                  chargeBoxId: data.activeSession.chargeBoxId,
                  friendlyName: data.activeSession.friendlyName,
                  connectorId: data.activeSession.connectorId,
                  connectorType: data.activeSession.connectorType,
                  initialKwh: data.activeSession.initialKwh,
                  startedAt: data.activeSession.startedAt,
                  tagDisplayName: data.activeSession.tagDisplayName,
                  estimatedCost: data.activeSession.estimatedCost,
                  currencySymbol: data.activeSession.currencySymbol,
                  tariffPerKwh: data.activeSession.tariffPerKwh,
                  walletBalanceCents: data.activeSession.walletBalanceCents,
                  walletThresholdCents: data.activeSession.walletThresholdCents,
                }}
              />
            </SectionCard>
          )}

          <SectionCard
            title="Overview"
            icon={CircleDollarSign}
            accent="blue"
            actions={data.billingPortalUrl
              ? (
                <a
                  href={data.billingPortalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                  aria-label="Open Lago billing portal in a new tab to update payment methods or change plan"
                >
                  Manage in billing portal
                  <span aria-hidden="true">↗</span>
                </a>
              )
              : undefined}
          >
            <BillingOverviewCard {...data.overview} accent="blue" />
          </SectionCard>

          <SectionCard
            title="Plan & Usage"
            icon={Gauge}
            accent="blue"
            actions={
              <BillingPeriodSwitcher
                value="current"
                basePath="/billing"
                supportedPeriods={["current"]}
              />
            }
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
              <div className="min-w-0 rounded-lg border bg-card p-4 lg:col-span-2">
                <PeriodUsageChart
                  points={data.dailyUsage}
                  periodLabel={data.periodLabel}
                  accent="blue"
                  emphasizeTotal
                />
              </div>
              <div className="min-w-0 rounded-lg border bg-card p-4 lg:col-span-1">
                <PeriodBreakdownCard
                  points={data.dailyUsage}
                  accent="blue"
                />
              </div>
            </div>
          </SectionCard>

          {data.wallet && (
            <SectionCard title="Wallet" icon={Wallet} accent="blue">
              <CustomerWalletSection wallet={data.wallet} accent="blue" />
            </SectionCard>
          )}

          <div id="invoices">
            <SectionCard title="Invoices" icon={Receipt} accent="blue">
              <div className="flex flex-col gap-4">
                <CustomerInvoiceFilterBar
                  initial={data.filters}
                  accent="blue"
                />
                {data.invoices.rows.length === 0
                  ? (
                    <EmptyState
                      icon={Receipt}
                      accent="blue"
                      title="No invoices to show"
                      description={hasActiveFilters
                        ? "Try clearing the filters or widening the date range."
                        : "Invoices appear here as your operator finalizes them."}
                      primaryAction={hasActiveFilters
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
