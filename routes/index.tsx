/**
 * Root dashboard route — the customer dashboard for customer users; admins
 * are redirected to `/admin`.
 *
 * Server loader (customer branch): fetches profile/scope, last 5 sessions
 * (enriched with charger metadata + duration), next reservation, current
 * usage (daily series + plan breakdown), charger list (for the Pick
 * Charger modal) — everything passed to the orchestrator island as props.
 */

import type { FreshContext } from "fresh";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { define } from "../utils.ts";
import type { State } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { resolveCustomerScope } from "../src/lib/scoping.ts";
import { SidebarLayout } from "../components/SidebarLayout.tsx";
import CustomerDashboard, {
  type CustomerDashboardProps,
} from "../islands/customer/CustomerDashboard.tsx";
import ImpersonationBanner from "../islands/customer/ImpersonationBanner.tsx";
import ActiveSessionBanner from "../islands/customer/ActiveSessionBanner.tsx";
import { config } from "../src/lib/config.ts";
import { lagoClient } from "../src/lib/lago-client.ts";
import { logger } from "../src/lib/utils/logger.ts";
import type { PlanInfo } from "../components/customer/PlanInfoCard.tsx";
import type { UsageDayPoint } from "../islands/customer/PeriodUsageChart.tsx";
import {
  currencySymbolFor,
  derivePlanInfo,
  enumerateDays,
  localDayKey,
  periodWindow,
} from "../src/lib/billing-derive.ts";
import type { FormFactor } from "../src/lib/types/steve.ts";
import type {
  CustomerChargerCardDto,
  CustomerChargerStatus,
} from "../islands/customer/CustomerChargersSection.tsx";
import { normalizeStatus } from "../islands/shared/charger-visuals.ts";

const log = logger.child("DashboardLoader");

interface LoaderData {
  props: CustomerDashboardProps;
  impersonation: {
    customerName: string;
    customerEmail: string;
    redirectTo: string;
  } | null;
  activeSessionLite: {
    steveTransactionId: number;
    chargeBoxId: string | null;
    connectorType?: string | null;
    connectorId?: number | null;
    powerKw?: number;
    kwh: number;
    startedAt: string | null;
    estimatedCost?: number;
    currencySymbol?: string;
  } | null;
}

async function loadCustomerData(
  ctx: FreshContext<State>,
  args: {
    userId: string;
    email: string;
    userName: string | null;
    actingAs?: string;
    period: "current" | "previous" | "year";
  },
): Promise<LoaderData> {
  const scope = await resolveCustomerScope(ctx);

  // ── Active session ────────────────────────────────────────────────
  let activeSession: CustomerDashboardProps["activeSession"] = null;
  let activeSessionLite: LoaderData["activeSessionLite"] = null;
  if (scope.mappingIds.length > 0) {
    try {
      const mappingIds = scope.mappingIds;
      const [active] = await db
        .select({
          steveTransactionId: schema.syncedTransactionEvents.steveTransactionId,
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
              mappingIds,
            ),
            eq(schema.transactionSyncState.isFinalized, false),
          ),
        )
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .limit(1);
      if (active) {
        const initialKwh = Number(active.totalKwhBilled ?? 0);
        activeSession = {
          steveTransactionId: active.steveTransactionId,
          chargeBoxId: null,
          connectorId: null,
          connectorType: null,
          initialKwh,
          startedAt: active.syncedAt ? active.syncedAt.toISOString() : null,
          tagDisplayName: active.tagDisplayName,
        };
        activeSessionLite = {
          steveTransactionId: active.steveTransactionId,
          chargeBoxId: null,
          connectorId: null,
          connectorType: null,
          kwh: initialKwh,
          startedAt: active.syncedAt ? active.syncedAt.toISOString() : null,
        };
      }
    } catch (err) {
      console.warn("dashboard active-session lookup failed:", err);
    }
  }

  // ── Recent sessions (last 5) — enriched with min/max syncedAt per txn ──
  let recentSessions: CustomerDashboardProps["recentSessions"] = [];
  if (scope.mappingIds.length > 0) {
    try {
      const mappingIds = scope.mappingIds;
      // Aggregate by steve_transaction_id so we see each session once with
      // total kWh, first/last event timestamps, and a finalized flag.
      const rows = await db
        .select({
          steveTransactionId: schema.syncedTransactionEvents.steveTransactionId,
          totalKwh: sql<
            number
          >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
          firstAt: sql<
            Date | null
          >`MIN(${schema.syncedTransactionEvents.syncedAt})`,
          lastAt: sql<
            Date | null
          >`MAX(${schema.syncedTransactionEvents.syncedAt})`,
          anyFinal: sql<
            boolean
          >`BOOL_OR(${schema.syncedTransactionEvents.isFinal})`,
          // Arbitrary row id for React keys.
          id: sql<number>`MAX(${schema.syncedTransactionEvents.id})`,
        })
        .from(schema.syncedTransactionEvents)
        .where(
          inArray(schema.syncedTransactionEvents.userMappingId, mappingIds),
        )
        .groupBy(schema.syncedTransactionEvents.steveTransactionId)
        .orderBy(desc(sql`MAX(${schema.syncedTransactionEvents.syncedAt})`))
        .limit(5);

      recentSessions = rows.map((r) => {
        const first = r.firstAt ? new Date(r.firstAt).getTime() : null;
        const last = r.lastAt ? new Date(r.lastAt).getTime() : null;
        const durationMinutes = first != null && last != null && last > first
          ? Math.round((last - first) / 60000)
          : null;
        return {
          id: r.id,
          steveTransactionId: r.steveTransactionId,
          syncedAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
          startedAt: r.firstAt ? new Date(r.firstAt).toISOString() : null,
          endedAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
          kwhDelta: Number(r.totalKwh ?? 0),
          isFinalized: r.anyFinal === true,
          durationMinutes,
        };
      });
    } catch (err) {
      console.warn("dashboard recent-sessions lookup failed:", err);
    }
  }
  const lastSession = recentSessions.find((s) => s.isFinalized) ??
    recentSessions[0] ?? null;

  // ── Next reservation ──────────────────────────────────────────────
  let nextReservation: CustomerDashboardProps["nextReservation"] = null;
  if (scope.ocppTagPks.length > 0) {
    try {
      const now = new Date();
      const [r] = await db
        .select()
        .from(schema.reservations)
        .where(
          and(
            inArray(schema.reservations.steveOcppTagPk, scope.ocppTagPks),
            gte(schema.reservations.endAt, now),
          ),
        )
        .orderBy(asc(schema.reservations.startAt))
        .limit(1);
      if (r) {
        nextReservation = {
          id: r.id,
          chargeBoxId: r.chargeBoxId,
          connectorId: r.connectorId,
          startAtIso: r.startAt.toISOString(),
          endAtIso: r.endAt.toISOString(),
          status: r.status,
          displayName: null,
        };
      }
    } catch (err) {
      console.warn("dashboard reservation lookup failed:", err);
    }
  }

  // ── Usage series + total for the requested period ─────────────────
  const { from, to, label } = periodWindow(args.period);
  let usageValue = 0;
  const dayBuckets = new Map<string, number>();
  for (const d of enumerateDays(from, to)) dayBuckets.set(d, 0);

  if (scope.mappingIds.length > 0) {
    try {
      const mappingIds = scope.mappingIds;
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
              mappingIds,
            ),
            gte(schema.syncedTransactionEvents.syncedAt, from),
            lt(schema.syncedTransactionEvents.syncedAt, to),
          ),
        );
      for (const r of rows) {
        const kwh = Number(r.kwhDelta ?? 0);
        usageValue += kwh;
        if (r.syncedAt) {
          const key = localDayKey(new Date(r.syncedAt));
          dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + kwh);
        }
      }
    } catch (err) {
      console.warn("dashboard usage lookup failed:", err);
    }
  }

  const dailyUsage: UsageDayPoint[] = [...dayBuckets.entries()].map((
    [date, kwh],
  ) => ({
    date,
    kwh: Number(kwh.toFixed(3)),
  }));

  // ── Charger list (powers Pick-charger modal + counts pill + section) ──
  let availableChargers = 0;
  let totalChargers = 0;
  const chargerOptions: Array<{
    chargeBoxId: string;
    friendlyName: string | null;
    status: string | null;
    online: boolean;
  }> = [];
  const chargerCards: CustomerChargerCardDto[] = [];
  const chargerMeta = new Map<
    string,
    { friendlyName: string | null; formFactor: FormFactor | null }
  >();
  const ownedChargeBoxIds: string[] = [];
  if (nextReservation?.chargeBoxId) {
    ownedChargeBoxIds.push(nextReservation.chargeBoxId);
  }

  // Pre-compute the set of chargeBoxIds with an active/confirmed reservation
  // covering "now" so each card can toggle to the `reserved` bucket.
  const reservedNow = new Set<string>();
  try {
    const now = new Date();
    const rows = await db
      .select({
        chargeBoxId: schema.reservations.chargeBoxId,
      })
      .from(schema.reservations)
      .where(
        and(
          inArray(schema.reservations.status, ["active", "confirmed"]),
          lt(schema.reservations.startAt, now),
          gte(schema.reservations.endAt, now),
        ),
      );
    for (const r of rows) reservedNow.add(r.chargeBoxId);
  } catch (err) {
    console.warn("dashboard reservations-now lookup failed:", err);
  }

  try {
    const rows = await db
      .select({
        chargeBoxId: schema.chargersCache.chargeBoxId,
        friendlyName: schema.chargersCache.friendlyName,
        lastStatus: schema.chargersCache.lastStatus,
        lastStatusAt: schema.chargersCache.lastStatusAt,
        lastSeenAt: schema.chargersCache.lastSeenAt,
        formFactor: schema.chargersCache.formFactor,
      })
      .from(schema.chargersCache)
      .limit(50);
    const ONLINE_WINDOW_MS = 60 * 60 * 1000;
    const now = Date.now();
    totalChargers = rows.length;
    for (const r of rows) {
      const online = r.lastSeenAt
        ? now - new Date(r.lastSeenAt).getTime() < ONLINE_WINDOW_MS
        : false;
      if ((r.lastStatus ?? "") === "Available" && online) availableChargers++;
      chargerOptions.push({
        chargeBoxId: r.chargeBoxId,
        friendlyName: r.friendlyName,
        status: r.lastStatus,
        online,
      });
      const formFactor = (r.formFactor ?? "generic") as FormFactor;
      chargerMeta.set(r.chargeBoxId, {
        friendlyName: r.friendlyName,
        formFactor,
      });

      // Effective status for the customer-facing card. Priority:
      //   offline (stale >60m or missing)   →
      //   in_use  (normalizeStatus === Charging based on last OCPP status) →
      //   reserved (active/confirmed window covers now)                     →
      //   online  (everything else).
      const ui = normalizeStatus(
        r.lastStatus,
        r.lastStatusAt ? r.lastStatusAt.toISOString() : null,
        false,
      );
      let status: CustomerChargerStatus;
      if (!online || ui === "Offline") {
        status = "offline";
      } else if (ui === "Charging") {
        status = "in_use";
      } else if (reservedNow.has(r.chargeBoxId)) {
        status = "reserved";
      } else {
        status = "online";
      }
      chargerCards.push({
        chargeBoxId: r.chargeBoxId,
        friendlyName: r.friendlyName,
        formFactor,
        status,
      });
    }
  } catch (err) {
    console.warn("dashboard charger-counts lookup failed:", err);
  }

  // NOTE: We don't have a `transactions` table to resolve chargeBoxId per
  // session — charger metadata is left null on recent-activity rows. The UI
  // falls back to "Session #N" when chargerName is missing.
  void chargerMeta;

  // ── Plan info (from Lago — best-effort, tolerant of failure) ──────
  let planInfo: PlanInfo | null = null;
  let currency = "EUR";
  try {
    if (scope.lagoCustomerExternalId) {
      // Resolve the active subscription and its plan code.
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
              scope.lagoCustomerExternalId,
            ),
            eq(schema.userMappings.isActive, true),
            isNotNull(schema.userMappings.lagoSubscriptionExternalId),
            ne(schema.userMappings.lagoSubscriptionExternalId, ""),
          ),
        );
      const subId = mappingRows[0]?.subscriptionExternalId ?? null;
      if (subId) {
        const [{ subscription } , usage] = await Promise.all([
          lagoClient.getSubscription(subId).catch(() => ({ subscription: null } as const)),
          lagoClient.getCurrentUsage(scope.lagoCustomerExternalId, subId).catch(
            () => null,
          ),
        ]);
        if (usage) currency = usage.currency || currency;
        const planCode = subscription?.plan_code ?? null;
        if (planCode) {
          const planRaw = await lagoClient.getPlan(planCode).catch(() => null);
          if (planRaw) {
            planInfo = derivePlanInfo(
              planRaw as unknown as Record<string, unknown>,
              usageValue,
              currencySymbolFor(currency),
            );
            if (planInfo && subscription?.name) planInfo.name = subscription.name;
          }
        }
      }
    }
  } catch (err) {
    log.warn("Failed to fetch plan info for dashboard", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const operatorEmail = config.OPERATOR_CONTACT_EMAIL || undefined;

  const firstRun = recentSessions.length === 0 && scope.mappingIds.length === 0;

  // Enrich nextReservation with the charger's friendly name (already cached
   // in chargerMeta from the chargers query above).
  if (nextReservation) {
    const meta = chargerMeta.get(nextReservation.chargeBoxId);
    if (meta?.friendlyName) {
      nextReservation = {
        ...nextReservation,
        friendlyName: meta.friendlyName,
      };
    }
  }

  const props: CustomerDashboardProps = {
    user: {
      id: args.userId,
      name: args.userName,
      email: args.email,
    },
    isActive: scope.isActive,
    firstRun,
    operatorEmail,
    activeSession,
    lastSession,
    recentSessions,
    nextReservation,
    usage: {
      value: usageValue,
      cap: null,
      periodLabel: label,
      period: args.period,
    },
    dailyUsage,
    plan: planInfo,
    currency,
    ownedChargeBoxIds,
    chargerCounts: {
      available: availableChargers,
      total: totalChargers,
    },
    chargerOptions,
    chargers: chargerCards,
  };

  let impersonation: LoaderData["impersonation"] = null;
  if (args.actingAs) {
    impersonation = {
      customerName: args.userName ?? args.email,
      customerEmail: args.email,
      redirectTo: "/admin",
    };
  }

  return { props, activeSessionLite, impersonation };
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login" },
      });
    }

    if (
      ctx.state.user.role === "admin" && !ctx.state.actingAs
    ) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin" },
      });
    }

    const url = new URL(ctx.req.url);
    const periodRaw = (url.searchParams.get("period") ?? "current") as
      | "current"
      | "previous"
      | "year";
    const period = ["current", "previous", "year"].includes(periodRaw)
      ? periodRaw
      : "current";

    const data = await loadCustomerData(ctx, {
      userId: ctx.state.user.id,
      email: ctx.state.user.email,
      userName: ctx.state.user.name ?? null,
      actingAs: ctx.state.actingAs,
      period,
    });

    return { data };
  },
});

export default define.page<typeof handler>(
  function DashboardRoot({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        role="customer"
        accentColor="blue"
      >
        {data.impersonation && (
          <ImpersonationBanner
            customerName={data.impersonation.customerName}
            customerEmail={data.impersonation.customerEmail}
            redirectTo={data.impersonation.redirectTo}
          />
        )}
        <ActiveSessionBanner initial={data.activeSessionLite} />
        <CustomerDashboard {...data.props} />
      </SidebarLayout>
    );
  },
);
