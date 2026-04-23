/**
 * Root dashboard route — the customer dashboard for customer users; admins
 * are redirected to `/admin` (their existing dashboard, now hosted at
 * `routes/admin/index.tsx`).
 *
 * Once Track A's hostname-dispatch middleware lands, this branching becomes
 * unnecessary — `polaris.express/` resolves to this file and
 * `manage.polaris.express/` resolves to `routes/admin/index.tsx`. The
 * temporary in-route redirect keeps both surfaces serving from one host
 * cleanly today.
 *
 * Server loader (customer branch): fetches profile/scope, last 3 sessions,
 * next reservation, current usage — everything passed to the orchestrator
 * island as props for SSR + initial paint.
 */

import type { FreshContext } from "fresh";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { define } from "../utils.ts";
import type { State } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { resolveCustomerScope } from "../src/lib/scoping.ts";
import { CUSTOMER_NAV_SECTIONS } from "../src/lib/customer-navigation.ts";
import { SidebarLayout } from "../components/SidebarLayout.tsx";
import { PageCard } from "../components/PageCard.tsx";
import CustomerDashboard, {
  type CustomerDashboardProps,
} from "../islands/customer/CustomerDashboard.tsx";
import ImpersonationBanner from "../islands/customer/ImpersonationBanner.tsx";
import ActiveSessionBanner from "../islands/customer/ActiveSessionBanner.tsx";
import { config } from "../src/lib/config.ts";

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

function periodWindow(period: "current" | "previous" | "year"): {
  from: Date;
  to: Date;
  label: string;
} {
  const now = new Date();
  if (period === "year") {
    return {
      from: new Date(now.getFullYear(), 0, 1),
      to: new Date(now.getFullYear() + 1, 0, 1),
      label: "this year",
    };
  }
  if (period === "previous") {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 1),
      label: "last month",
    };
  }
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    label: "this month",
  };
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
  // The schema doesn't yet carry charge_box_id / connector_id /
  // transaction_started_at on `transaction_sync_state`, so we identify the
  // active session via the most-recent NON-finalized syncedTransactionEvents
  // row joined back through user_mappings. This is the same pattern
  // `LiveSessionCard` uses on the admin transaction-detail page.
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
          chargeBoxId: null, // unavailable until track-A schema change
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

  // ── Recent sessions (last 3) ──────────────────────────────────────
  let recentSessions: CustomerDashboardProps["recentSessions"] = [];
  if (scope.mappingIds.length > 0) {
    try {
      const mappingIds = scope.mappingIds;
      const rows = await db
        .select({
          id: schema.syncedTransactionEvents.id,
          steveTransactionId: schema.syncedTransactionEvents.steveTransactionId,
          syncedAt: schema.syncedTransactionEvents.syncedAt,
          kwhDelta: schema.syncedTransactionEvents.kwhDelta,
          isFinal: schema.syncedTransactionEvents.isFinal,
        })
        .from(schema.syncedTransactionEvents)
        .where(
          inArray(schema.syncedTransactionEvents.userMappingId, mappingIds),
        )
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .limit(3);
      recentSessions = rows.map((r) => ({
        id: r.id,
        steveTransactionId: r.steveTransactionId,
        syncedAt: r.syncedAt ? r.syncedAt.toISOString() : null,
        kwhDelta: Number(r.kwhDelta ?? 0),
        isFinalized: r.isFinal === true,
      }));
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

  // ── Usage for the requested period ────────────────────────────────
  const url = ""; // for symmetry with handler — period passed in args.
  void url;
  const { from, to, label } = periodWindow(args.period);
  let usageValue = 0;
  if (scope.mappingIds.length > 0) {
    try {
      const mappingIds = scope.mappingIds;
      const [row] = await db
        .select({
          total: sql<
            number
          >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
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
      usageValue = Number(row?.total ?? 0);
    } catch (err) {
      console.warn("dashboard usage lookup failed:", err);
    }
  }

  // ── Charger counts (Ready card pill) ──────────────────────────────
  let availableChargers = 0;
  let totalChargers = 0;
  const ownedChargeBoxIds: string[] = [];
  if (nextReservation?.chargeBoxId) {
    ownedChargeBoxIds.push(nextReservation.chargeBoxId);
  }
  try {
    const rows = await db
      .select({
        chargeBoxId: schema.chargersCache.chargeBoxId,
        lastStatus: schema.chargersCache.lastStatus,
      })
      .from(schema.chargersCache)
      .limit(50);
    totalChargers = rows.length;
    availableChargers = rows.filter(
      (r) => (r.lastStatus ?? "") === "Available",
    ).length;
  } catch (err) {
    console.warn("dashboard charger-counts lookup failed:", err);
  }

  const operatorEmail = config.OPERATOR_CONTACT_EMAIL || undefined;

  // First-run heuristic: zero recent sessions AND zero mappings yet.
  const firstRun = recentSessions.length === 0 && scope.mappingIds.length === 0;

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
    ownedChargeBoxIds,
    chargerCounts: {
      available: availableChargers,
      total: totalChargers,
    },
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

    // Admins (not impersonating) get the existing admin dashboard at /admin.
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
        navSections={CUSTOMER_NAV_SECTIONS}
        defaultTheme="light"
      >
        {data.impersonation && (
          <ImpersonationBanner
            customerName={data.impersonation.customerName}
            customerEmail={data.impersonation.customerEmail}
            redirectTo={data.impersonation.redirectTo}
          />
        )}
        <ActiveSessionBanner initial={data.activeSessionLite} />
        <PageCard
          title="Dashboard"
          description={data.impersonation
            ? `Viewing as ${data.impersonation.customerName}`
            : data.props.user.name
            ? `Welcome back, ${data.props.user.name.split(" ")[0]}.`
            : "Welcome back."}
          colorScheme="blue"
        >
          <CustomerDashboard {...data.props} />
        </PageCard>
      </SidebarLayout>
    );
  },
);
