/**
 * /subscription — customer subscription overview.
 *
 * The Lago counterpart of `/billing` focused on the *plan* the customer is
 * on (not their invoices). One PageCard, accent=violet, with:
 *
 *   StatStrip [ Status · Estimated bill · kWh this period · Sessions this period ]
 *   SectionCard "Plan"             → PlanInfoCard + entitlements + sub dates
 *   SectionCard "Estimated bill"   → charges_usage breakdown + total
 *   SectionCard "Recent activity"  → last 10 sessions + link to /sessions
 *   SectionCard "Manage"           → primary CTA → Lago hosted customer portal
 *
 * Loader logic mirrors the relevant slice of `/billing`. All Lago data is
 * already fetched there — no new endpoints required. Failures degrade
 * gracefully (each section can render with partial/null data).
 */

import { and, desc, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
import {
  EmptyState,
  MetricTile,
  StatStrip,
  type StatStripItem,
} from "../../components/shared/index.ts";
import { BlurFade } from "../../components/magicui/blur-fade.tsx";
import {
  type PlanInfo,
  PlanInfoCard,
} from "../../components/customer/PlanInfoCard.tsx";
import {
  PlanName,
  planTierLabel,
} from "../../components/customer/PlanName.tsx";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  BatteryCharging,
  Bolt,
  Calendar,
  CircleDollarSign,
  ExternalLink,
  Gauge,
  Settings2,
  Zap,
} from "lucide-preact";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import {
  currencySymbolFor,
  derivePlanInfo,
  periodWindow,
} from "../../src/lib/billing-derive.ts";
import {
  type ChargingEntitlements,
  derivePlanChargingEntitlements,
} from "../../src/lib/types/lago.ts";
import {
  buildCumulativeMap,
  estimateEventCost,
  resolveCustomerTariff,
} from "../../src/lib/customer-tariff.ts";
import { formatMoney } from "../../src/lib/invoice-ui.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import { config } from "../../src/lib/config.ts";

const log = logger.child("CustomerSubscriptionPage");
const ACCENT = "violet" as const;

interface SubscriptionDates {
  startedAt: string | null;
  currentPeriodEndsAt: string | null;
  endingAt: string | null;
}

interface UsageBreakdownRow {
  metric: string;
  units: string;
  amountCents: number;
}

interface RecentSession {
  id: number;
  steveTransactionId: number;
  syncedAtIso: string | null;
  kwh: number;
  ocppTag: string | null;
  isFinal: boolean;
  costCents: number | null;
  costCoverage: "included" | "billed" | "unknown";
}

interface SubscriptionPageData {
  unlinked: boolean;
  planName: string | null;
  status: string | null;
  dates: SubscriptionDates;
  plan: PlanInfo | null;
  entitlements: ChargingEntitlements;
  estimate: {
    totalCents: number;
    currency: string;
    rows: UsageBreakdownRow[];
  } | null;
  periodKwh: number;
  periodSessionCount: number;
  periodLabel: string;
  recentSessions: RecentSession[];
  recentSessionsCurrency: string;
  portalUrl: string | null;
  operatorEmail?: string;
}

function statusToTone(
  status: string | null,
): "emerald" | "amber" | "rose" | "muted" {
  switch (status) {
    case "active":
      return "emerald";
    case "pending":
      return "amber";
    case "terminated":
    case "canceled":
      return "rose";
    default:
      return "muted";
  }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    const scope = await resolveCustomerScope(ctx);
    const hasLagoLink = scope.lagoCustomerExternalId !== null;

    const empty: SubscriptionPageData = {
      unlinked: !hasLagoLink,
      planName: null,
      status: null,
      dates: { startedAt: null, currentPeriodEndsAt: null, endingAt: null },
      plan: null,
      entitlements: { maxAmps: null, rampedCharge: null },
      estimate: null,
      periodKwh: 0,
      periodSessionCount: 0,
      periodLabel: "",
      recentSessions: [],
      recentSessionsCurrency: "EUR",
      portalUrl: null,
      operatorEmail: config.OPERATOR_CONTACT_EMAIL || undefined,
    };

    if (!hasLagoLink) return { data: empty };

    const extCustomerId = scope.lagoCustomerExternalId!;
    const { from: periodFrom, to: periodTo, label: periodLabel } = periodWindow(
      "current",
    );

    // ── Period usage (kWh + session count) from local DB ───────────────
    let periodKwh = 0;
    let periodSessionCount = 0;
    if (scope.mappingIds.length > 0) {
      try {
        const rows = await db
          .select({
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
        periodSessionCount = rows.length;
        for (const r of rows) periodKwh += Number(r.kwhDelta ?? 0);
      } catch (err) {
        log.warn("period usage lookup failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Recent sessions (last 10) ──────────────────────────────────────
    let recentSessions: RecentSession[] = [];
    if (scope.mappingIds.length > 0) {
      try {
        const rows = await db
          .select({
            id: schema.syncedTransactionEvents.id,
            steveTransactionId:
              schema.syncedTransactionEvents.steveTransactionId,
            syncedAt: schema.syncedTransactionEvents.syncedAt,
            kwhDelta: schema.syncedTransactionEvents.kwhDelta,
            isFinal: schema.syncedTransactionEvents.isFinal,
            ocppTag: schema.userMappings.steveOcppIdTag,
            displayName: schema.userMappings.displayName,
          })
          .from(schema.syncedTransactionEvents)
          .leftJoin(
            schema.userMappings,
            eq(
              schema.syncedTransactionEvents.userMappingId,
              schema.userMappings.id,
            ),
          )
          .where(
            inArray(
              schema.syncedTransactionEvents.userMappingId,
              scope.mappingIds,
            ),
          )
          .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
          .limit(10);
        recentSessions = rows.map((r) => ({
          id: r.id,
          steveTransactionId: r.steveTransactionId,
          syncedAtIso: r.syncedAt ? r.syncedAt.toISOString() : null,
          kwh: Number(r.kwhDelta ?? 0),
          ocppTag: r.displayName ?? r.ocppTag ?? null,
          isFinal: !!r.isFinal,
          costCents: null,
          costCoverage: "unknown",
        }));
      } catch (err) {
        log.warn("recent sessions lookup failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Resolve subscription id ───────────────────────────────────────
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
      log.warn("subscription id resolve failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Lago: subscription, current usage, plan, portal URL ───────────
    let planName: string | null = null;
    let status: string | null = null;
    const dates: SubscriptionDates = {
      startedAt: null,
      currentPeriodEndsAt: null,
      endingAt: null,
    };
    let planInfo: PlanInfo | null = null;
    let entitlements: ChargingEntitlements = {
      maxAmps: null,
      rampedCharge: null,
    };
    let currency = "EUR";
    let estimate: SubscriptionPageData["estimate"] = null;

    if (subId) {
      try {
        const [{ subscription }, usage] = await Promise.all([
          lagoClient.getSubscription(subId).catch(
            () => ({ subscription: null } as const),
          ),
          lagoClient.getCurrentUsage(extCustomerId, subId).catch(() => null),
        ]);
        if (subscription) {
          status = subscription.status ?? null;
          planName = subscription.name ?? subscription.plan_code ?? null;
          dates.startedAt = subscription.started_at ?? null;
          dates.currentPeriodEndsAt =
            subscription.current_billing_period_ending_at ?? null;
          dates.endingAt = subscription.ending_at ?? null;
        }
        if (usage) {
          currency = usage.currency || currency;
          estimate = {
            totalCents: usage.total_amount_cents,
            currency,
            rows: usage.charges_usage.map((c) => ({
              metric: c.billable_metric.name,
              units: c.units,
              amountCents: c.amount_cents,
            })),
          };
        }
        const planCode = subscription?.plan_code ?? null;
        if (planCode) {
          const planRaw = await lagoClient.getPlan(planCode).catch(() => null);
          if (planRaw) {
            planInfo = derivePlanInfo(
              planRaw as unknown as Record<string, unknown>,
              periodKwh,
              currencySymbolFor(currency),
            );
            if (planInfo && planName) planInfo.name = planName;
            entitlements = derivePlanChargingEntitlements(planRaw);
          }
        }
      } catch (err) {
        log.warn("Lago subscription/usage fetch failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Portal URL (signed; resolve per-request) ──────────────────────
    let portalUrl: string | null = null;
    try {
      const resp = await lagoClient.getCustomerPortalUrl(extCustomerId);
      portalUrl = resp.customer.portal_url ?? null;
    } catch (err) {
      log.warn("portal URL fetch failed; hiding CTA", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Annotate recent sessions with estimated cost (tier-aware) ─────
    const tariff = await resolveCustomerTariff(extCustomerId);
    if (recentSessions.length > 0 && scope.mappingIds.length > 0) {
      try {
        let cumulative = new Map<number, number>();
        if (tariff.tiers.length > 0) {
          const periodRows = await db
            .select({
              id: schema.syncedTransactionEvents.id,
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
          cumulative = buildCumulativeMap(
            periodRows.map((r) => ({
              id: r.id,
              syncedAtMs: r.syncedAt ? new Date(r.syncedAt).getTime() : 0,
              kwh: Number(r.kwhDelta ?? 0),
            })),
          );
        }
        const periodFromMs = periodFrom.getTime();
        const periodToMs = periodTo.getTime();
        recentSessions = recentSessions.map((s) => {
          const ts = s.syncedAtIso ? new Date(s.syncedAtIso).getTime() : 0;
          const est = estimateEventCost(
            tariff,
            s.id,
            ts,
            s.kwh,
            cumulative,
            periodFromMs,
            periodToMs,
          );
          return { ...s, costCents: est.cents, costCoverage: est.coverage };
        });
      } catch (err) {
        log.warn("recent session cost estimate failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      data: {
        ...empty,
        unlinked: false,
        planName,
        status,
        dates,
        plan: planInfo,
        entitlements,
        estimate,
        periodKwh,
        periodSessionCount,
        periodLabel,
        recentSessions,
        recentSessionsCurrency: tariff.currency,
        portalUrl,
      } satisfies SubscriptionPageData,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export default define.page<typeof handler>(
  function CustomerSubscriptionPage({ data, url, state }) {
    if (data.unlinked) {
      return (
        <SidebarLayout
          currentPath={url.pathname}
          user={state.user}
          accentColor={ACCENT}
          role="customer"
        >
          <PageCard
            title="Your subscription"
            description="Plan, usage, and self-service."
            colorScheme={ACCENT}
          >
            <EmptyState
              icon={BadgeCheck}
              accent={ACCENT}
              title="No subscription on file"
              description="Contact your operator to provision a plan."
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

    const statusTone = statusToTone(data.status);
    const tierLabel = data.planName ? planTierLabel(data.planName) : "—";

    const stats: StatStripItem[] = [
      {
        key: "status",
        label: "Status",
        value: data.status
          ? data.status.charAt(0).toUpperCase() + data.status.slice(1)
          : "—",
        icon: BadgeCheck,
        tone: statusTone,
      },
      {
        key: "estimate",
        label: "Estimated bill",
        value: data.estimate
          ? formatMoney(data.estimate.totalCents, data.estimate.currency)
          : "—",
        icon: CircleDollarSign,
      },
      {
        key: "kwh",
        label: `kWh · ${data.periodLabel}`,
        value: `${
          data.periodKwh.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })
        } kWh`,
        icon: Bolt,
      },
      {
        key: "sessions",
        label: "Sessions this period",
        value: data.periodSessionCount,
        icon: Activity,
      },
    ];

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor={ACCENT}
        role="customer"
      >
        <PageCard
          title="Your subscription"
          description={data.planName
            ? `${tierLabel} plan`
            : "Plan, usage, and self-service."}
          colorScheme={ACCENT}
        >
          <div class="flex flex-col gap-6">
            <BlurFade direction="up" duration={0.35}>
              <StatStrip accent={ACCENT} items={stats} />
            </BlurFade>

            {/* Plan ──────────────────────────────────────────────────── */}
            <SectionCard
              title="Plan"
              icon={Zap}
              accent={ACCENT}
              actions={data.planName
                ? <PlanName name={data.planName} className="text-base" />
                : undefined}
            >
              <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div class="lg:col-span-2">
                  <PlanInfoCard plan={data.plan} accent={ACCENT} />
                </div>
                <div class="flex flex-col gap-4">
                  <MetricTile
                    icon={BatteryCharging}
                    label="Max amps"
                    value={data.entitlements.maxAmps != null
                      ? `${data.entitlements.maxAmps} A`
                      : "—"}
                    accent={ACCENT}
                    size="sm"
                  />
                  <MetricTile
                    icon={Gauge}
                    label="Ramped charge"
                    value={data.entitlements.rampedCharge == null
                      ? "—"
                      : data.entitlements.rampedCharge
                      ? "Enabled"
                      : "Disabled"}
                    accent={ACCENT}
                    size="sm"
                  />
                  <MetricTile
                    icon={Calendar}
                    label="Started"
                    value={formatDateShort(data.dates.startedAt)}
                    accent={ACCENT}
                    size="sm"
                  />
                  <MetricTile
                    icon={Calendar}
                    label="Period ends"
                    value={formatDateShort(data.dates.currentPeriodEndsAt)}
                    accent={ACCENT}
                    size="sm"
                  />
                  {data.dates.endingAt && (
                    <MetricTile
                      icon={Calendar}
                      label="Ends"
                      value={formatDateShort(data.dates.endingAt)}
                      accent="amber"
                      size="sm"
                    />
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Estimated bill ────────────────────────────────────────── */}
            <SectionCard
              title="Estimated bill"
              icon={CircleDollarSign}
              accent={ACCENT}
              description="Updates as you charge. Finalised at the end of the billing period."
            >
              {!data.estimate
                ? (
                  <p class="text-sm text-muted-foreground">
                    No usage to bill yet this period.
                  </p>
                )
                : (
                  <div class="flex flex-col gap-3">
                    {data.estimate.rows.length === 0
                      ? (
                        <p class="text-sm text-muted-foreground">
                          No usage charges yet this period.
                        </p>
                      )
                      : (
                        <ul class="divide-y divide-border rounded-md border bg-card">
                          {data.estimate.rows.map((row) => (
                            <li
                              key={row.metric}
                              class="flex items-baseline justify-between gap-3 px-3 py-2"
                            >
                              <div class="min-w-0">
                                <p class="text-sm font-medium truncate">
                                  {row.metric}
                                </p>
                                <p class="text-xs text-muted-foreground tabular-nums">
                                  {row.units} units
                                </p>
                              </div>
                              <p class="text-sm font-semibold tabular-nums">
                                {formatMoney(
                                  row.amountCents,
                                  data.estimate!.currency,
                                )}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    <div class="flex items-baseline justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                      <p class="text-sm font-medium">Total estimate</p>
                      <p class="text-base font-semibold tabular-nums">
                        {formatMoney(
                          data.estimate.totalCents,
                          data.estimate.currency,
                        )}
                      </p>
                    </div>
                  </div>
                )}
            </SectionCard>

            {/* Recent activity ──────────────────────────────────────── */}
            <SectionCard
              title="Recent activity"
              icon={Activity}
              accent={ACCENT}
              actions={
                <a
                  href="/sessions"
                  class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all
                  <ArrowUpRight class="size-3.5" />
                </a>
              }
            >
              {data.recentSessions.length === 0
                ? (
                  <p class="text-sm text-muted-foreground">
                    No charging sessions yet.
                  </p>
                )
                : (
                  <ul class="divide-y divide-border rounded-md border bg-card">
                    {data.recentSessions.map((s) => (
                      <li
                        key={s.id}
                        class="flex items-baseline justify-between gap-3 px-3 py-2"
                      >
                        <a
                          href={`/sessions/${s.id}`}
                          class="flex min-w-0 flex-1 items-baseline gap-3 hover:text-foreground"
                        >
                          <span class="text-sm font-medium tabular-nums">
                            {formatDateShort(s.syncedAtIso)}
                          </span>
                          <span class="truncate text-xs text-muted-foreground">
                            {s.ocppTag ?? "Unknown card"}
                          </span>
                        </a>
                        <span class="flex items-center gap-2 text-xs">
                          {!s.isFinal && (
                            <span class="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                              Live
                            </span>
                          )}
                          {s.costCoverage === "included"
                            ? (
                              <span class="font-medium text-emerald-600 dark:text-emerald-400">
                                Included
                              </span>
                            )
                            : s.costCoverage === "billed" && s.costCents != null
                            ? (
                              <span class="font-medium tabular-nums text-muted-foreground">
                                {formatMoney(
                                  s.costCents,
                                  data.recentSessionsCurrency,
                                )}
                              </span>
                            )
                            : null}
                          <span class="font-semibold tabular-nums">
                            {s.kwh.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })} kWh
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </SectionCard>

            {/* Manage ──────────────────────────────────────────────── */}
            <SectionCard
              title="Manage subscription"
              icon={Settings2}
              accent={ACCENT}
              description="Update payment methods, view invoices, change or cancel your plan in the hosted billing portal."
            >
              {data.portalUrl
                ? (
                  <a
                    href={data.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-2 rounded-md bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:text-violet-400 hover:bg-violet-500/15 transition-colors border border-violet-500/30"
                    aria-label="Open the hosted billing portal in a new tab"
                  >
                    <ExternalLink class="size-4" />
                    Open billing portal
                  </a>
                )
                : (
                  <p class="text-sm text-muted-foreground">
                    Billing portal is temporarily unavailable. Try again
                    shortly, or{" "}
                    <a
                      href={data.operatorEmail
                        ? `mailto:${data.operatorEmail}`
                        : "#"}
                      class="underline hover:text-foreground"
                    >
                      contact your operator
                    </a>.
                  </p>
                )}
            </SectionCard>
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
