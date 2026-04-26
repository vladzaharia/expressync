/**
 * GET /api/admin/dashboard/overview
 *
 * Single aggregated read for the admin landing page. Returns the operational
 * "war-room" snapshot in one round-trip:
 *
 *   - pulse:    sync tier, in-flight sync, charger fleet health, unread alerts
 *   - stats:    StatStrip values (kWh today, active sessions, chargers, etc.)
 *   - inFlightSync: latest sync_runs row when status='running' (else null)
 *   - schedule: sync_schedule_state singleton
 *   - health:   semantic warning rollups (offline chargers, failed syncs, ...)
 *   - weekly:   week-over-week aggregate metrics
 *
 * SSR uses this once; the dashboard islands re-poll it every 30s as a fallback
 * to SSE (which only carries deltas).
 */

import { define } from "@/utils.ts";
import { db } from "@/src/db/index.ts";
import * as schema from "@/src/db/schema.ts";
import { and, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { logger } from "@/src/lib/utils/logger.ts";

export interface DashboardOverview {
  pulse: {
    syncTier: "active" | "idle" | "dormant";
    nextRunAt: string | null;
    inFlightSyncRunId: number | null;
    chargersOnline: number;
    chargersTotal: number;
    unreadAlerts: number;
  };
  stats: {
    kwhToday: number;
    activeSessions: number;
    chargersOnline: number;
    chargersOffline: number;
    pendingReservations: number;
    syncSuccess7d: number;
  };
  inFlightSync: {
    id: number;
    startedAt: string;
    tagLinkingStatus: string | null;
    transactionSyncStatus: string | null;
    transactionsProcessed: number | null;
    eventsCreated: number | null;
  } | null;
  schedule: {
    currentTier: "active" | "idle" | "dormant";
    nextRunAt: string | null;
    lastActivityAt: string | null;
    pinnedTier: string | null;
    pinnedUntil: string | null;
  };
  health: {
    chargersOfflineGt1h: number;
    chargersDim10mTo1h: number;
    failedSyncs24h: number;
    overdueInvoices: number;
    breakerOpen: boolean;
    devicesOfflineGt1h: number;
  };
  weekly: {
    kwhWeek: number;
    kwhWeekPrior: number;
    syncRunsWeek: number;
    syncSuccessWeek: number;
    tagsActivatedWeek: number;
    reservationsCompletedWeek: number;
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export async function loadDashboardOverview(): Promise<DashboardOverview> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);
  const priorWeekStart = new Date(now.getTime() - 2 * SEVEN_DAYS_MS);
  const day1Ago = new Date(now.getTime() - ONE_DAY_MS);
  const hr1Ago = new Date(now.getTime() - ONE_HOUR_MS);
  const min10Ago = new Date(now.getTime() - TEN_MIN_MS);

  // Run independent reads in parallel — every entry returns a small scalar /
  // single row so we can fan them out without overloading the pool.
  const [
    scheduleRows,
    inFlightRow,
    chargerRollup,
    devicesOfflineRow,
    pendingReservationsRow,
    completedReservationsWeekRow,
    activeSessionsRow,
    unreadAlertsRow,
    failedSyncs24hRow,
    syncRateWeekRow,
    syncRunsWeekRow,
    overdueInvoicesRow,
    breakerRows,
    tagsActivatedWeekRow,
    kwhTodayRow,
    kwhWeekRow,
    kwhPriorWeekRow,
  ] = await Promise.all([
    db.select().from(schema.syncScheduleState).limit(1),
    db
      .select({
        id: schema.syncRuns.id,
        startedAt: schema.syncRuns.startedAt,
        tagLinkingStatus: schema.syncRuns.tagLinkingStatus,
        transactionSyncStatus: schema.syncRuns.transactionSyncStatus,
        transactionsProcessed: schema.syncRuns.transactionsProcessed,
        eventsCreated: schema.syncRuns.eventsCreated,
      })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.status, "running"))
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(1),
    db
      .select({
        total: count(),
        online: sql<
          number
        >`COUNT(*) FILTER (WHERE ${schema.chargersCache.lastStatusAt} >= ${min10Ago.toISOString()})`,
        dim: sql<
          number
        >`COUNT(*) FILTER (WHERE ${schema.chargersCache.lastStatusAt} < ${min10Ago.toISOString()} AND ${schema.chargersCache.lastStatusAt} >= ${hr1Ago.toISOString()})`,
        offline: sql<
          number
        >`COUNT(*) FILTER (WHERE ${schema.chargersCache.lastStatusAt} IS NULL OR ${schema.chargersCache.lastStatusAt} < ${hr1Ago.toISOString()})`,
      })
      .from(schema.chargersCache),
    db
      .select({ value: count() })
      .from(schema.devices)
      .where(
        and(
          isNull(schema.devices.deletedAt),
          isNull(schema.devices.revokedAt),
          sql`${schema.devices.lastSeenAt} IS NULL OR ${schema.devices.lastSeenAt} < ${hr1Ago.toISOString()}`,
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.reservations)
      .where(eq(schema.reservations.status, "pending")),
    db
      .select({ value: count() })
      .from(schema.reservations)
      .where(
        and(
          eq(schema.reservations.status, "completed"),
          gte(schema.reservations.updatedAt, weekStart),
        ),
      ),
    // "Active sessions" = unfinalized transactions whose latest meter event
    // arrived in the last 15 min. Cheap proxy for "currently charging".
    db
      .select({ value: count() })
      .from(schema.transactionSyncState)
      .where(eq(schema.transactionSyncState.isFinalized, false)),
    db
      .select({ value: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.audience, "admin"),
          isNull(schema.notifications.readAt),
          isNull(schema.notifications.dismissedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.status, "failed"),
          gte(schema.syncRuns.startedAt, day1Ago),
        ),
      ),
    db
      .select({
        total: count(),
        success: sql<
          number
        >`COUNT(*) FILTER (WHERE ${schema.syncRuns.status} = 'completed')`,
      })
      .from(schema.syncRuns)
      .where(gte(schema.syncRuns.startedAt, weekStart)),
    db
      .select({ value: count() })
      .from(schema.syncRuns)
      .where(gte(schema.syncRuns.startedAt, weekStart)),
    db
      .select({ value: count() })
      .from(schema.lagoInvoices)
      .where(
        and(
          isNull(schema.lagoInvoices.deletedAt),
          eq(schema.lagoInvoices.paymentOverdue, true),
        ),
      ),
    db.select().from(schema.lagoWebhookBreakerState).limit(1),
    db
      .select({ value: count() })
      .from(schema.tagChangeLog)
      .where(
        and(
          eq(schema.tagChangeLog.changeType, "activated"),
          gte(schema.tagChangeLog.detectedAt, weekStart),
        ),
      ),
    db
      .select({
        value: sql<
          number
        >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
      })
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, todayStart)),
    db
      .select({
        value: sql<
          number
        >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
      })
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, weekStart)),
    db
      .select({
        value: sql<
          number
        >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
      })
      .from(schema.syncedTransactionEvents)
      .where(
        and(
          gte(schema.syncedTransactionEvents.syncedAt, priorWeekStart),
          lt(schema.syncedTransactionEvents.syncedAt, weekStart),
        ),
      ),
  ]);

  const schedule = scheduleRows[0] ?? null;
  const fleet = chargerRollup[0] ?? { total: 0, online: 0, dim: 0, offline: 0 };
  const inFlight = inFlightRow[0] ?? null;
  const breaker = breakerRows[0] ?? null;
  const breakerOpen = !!(breaker?.disabledUntilMs &&
    breaker.disabledUntilMs > Date.now());

  const syncRateWeek = syncRateWeekRow[0] ?? { total: 0, success: 0 };
  const syncSuccess7d = Number(syncRateWeek.total) === 0 ? 100 : Math.round(
    (Number(syncRateWeek.success) / Number(syncRateWeek.total)) * 100,
  );

  return {
    pulse: {
      syncTier: (schedule?.currentTier ?? "idle") as
        | "active"
        | "idle"
        | "dormant",
      nextRunAt: schedule?.nextRunAt
        ? new Date(schedule.nextRunAt).toISOString()
        : null,
      inFlightSyncRunId: inFlight?.id ?? null,
      chargersOnline: Number(fleet.online),
      chargersTotal: Number(fleet.total),
      unreadAlerts: Number(unreadAlertsRow[0]?.value ?? 0),
    },
    stats: {
      kwhToday: Number(kwhTodayRow[0]?.value ?? 0),
      activeSessions: Number(activeSessionsRow[0]?.value ?? 0),
      chargersOnline: Number(fleet.online),
      chargersOffline: Number(fleet.offline),
      pendingReservations: Number(pendingReservationsRow[0]?.value ?? 0),
      syncSuccess7d,
    },
    inFlightSync: inFlight
      ? {
        id: inFlight.id,
        startedAt: new Date(inFlight.startedAt).toISOString(),
        tagLinkingStatus: inFlight.tagLinkingStatus,
        transactionSyncStatus: inFlight.transactionSyncStatus,
        transactionsProcessed: inFlight.transactionsProcessed,
        eventsCreated: inFlight.eventsCreated,
      }
      : null,
    schedule: {
      currentTier: (schedule?.currentTier ?? "idle") as
        | "active"
        | "idle"
        | "dormant",
      nextRunAt: schedule?.nextRunAt
        ? new Date(schedule.nextRunAt).toISOString()
        : null,
      lastActivityAt: schedule?.lastActivityAt
        ? new Date(schedule.lastActivityAt).toISOString()
        : null,
      pinnedTier: schedule?.pinnedTier ?? null,
      pinnedUntil: schedule?.pinnedUntil
        ? new Date(schedule.pinnedUntil).toISOString()
        : null,
    },
    health: {
      chargersOfflineGt1h: Number(fleet.offline),
      chargersDim10mTo1h: Number(fleet.dim),
      failedSyncs24h: Number(failedSyncs24hRow[0]?.value ?? 0),
      overdueInvoices: Number(overdueInvoicesRow[0]?.value ?? 0),
      breakerOpen,
      devicesOfflineGt1h: Number(devicesOfflineRow[0]?.value ?? 0),
    },
    weekly: {
      kwhWeek: Number(kwhWeekRow[0]?.value ?? 0),
      kwhWeekPrior: Number(kwhPriorWeekRow[0]?.value ?? 0),
      syncRunsWeek: Number(syncRunsWeekRow[0]?.value ?? 0),
      syncSuccessWeek: syncSuccess7d,
      tagsActivatedWeek: Number(tagsActivatedWeekRow[0]?.value ?? 0),
      reservationsCompletedWeek: Number(
        completedReservationsWeekRow[0]?.value ?? 0,
      ),
    },
  };
}

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      const overview = await loadDashboardOverview();
      return new Response(JSON.stringify(overview), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      logger.error(
        "API",
        "Failed to load dashboard overview",
        error as Error,
      );
      return new Response(
        JSON.stringify({ error: "Failed to load dashboard overview" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
