import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { gte, sql } from "drizzle-orm";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

/**
 * GET /api/dashboard/stats
 *
 * Get comprehensive dashboard statistics including:
 * - Tag counts (active/blocked)
 * - Customer/subscription counts
 * - kWh delivered by timeframe (day/week/month)
 * - Sync success rates by timeframe
 *
 * Query params:
 * - None (returns all statistics)
 *
 * Returns comprehensive dashboard data
 */
export const handler = define.handlers({
  async GET(_ctx) {
    try {
      // Fetch OCPP tags from StEvE
      let activeTags = 0;
      let blockedTags = 0;
      try {
        const tags = await steveClient.getOcppTags();
        activeTags = tags.filter(
          (tag) =>
            tag.maxActiveTransactionCount === null ||
            tag.maxActiveTransactionCount === undefined ||
            tag.maxActiveTransactionCount === -1 ||
            tag.maxActiveTransactionCount > 0,
        ).length;
        blockedTags = tags.filter(
          (tag) => tag.maxActiveTransactionCount === 0,
        ).length;
      } catch (error) {
        logger.error("API", "Failed to fetch OCPP tags", error as Error);
      }

      // Fetch customers and subscriptions from Lago
      let customerCount = 0;
      let subscriptionCount = 0;
      try {
        const [customersData, subscriptionsData] = await Promise.all([
          lagoClient.getCustomers(),
          lagoClient.getSubscriptions(),
        ]);
        customerCount = customersData.customers.length;
        subscriptionCount = subscriptionsData.subscriptions.length;
      } catch (error) {
        logger.error("API", "Failed to fetch Lago data", error as Error);
      }

      // Calculate date ranges
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);
      weekStart.setHours(0, 0, 0, 0);

      const monthStart = new Date(now);
      monthStart.setDate(monthStart.getDate() - 30);
      monthStart.setHours(0, 0, 0, 0);

      // Convert dates to ISO strings for embedding in SQL templates
      // (postgres.js driver does not accept Date objects as inline sql parameters)
      const todayIso = todayStart.toISOString();
      const weekIso = weekStart.toISOString();

      // Fetch kWh delivered by all three timeframes in a single SQL query
      const [kwhStats] = await db
        .select({
          kwhDay: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncedTransactionEvents.syncedAt} >= ${todayIso} THEN ${schema.syncedTransactionEvents.kwhDelta} ELSE 0 END), 0)`,
          kwhWeek: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncedTransactionEvents.syncedAt} >= ${weekIso} THEN ${schema.syncedTransactionEvents.kwhDelta} ELSE 0 END), 0)`,
          kwhMonth: sql<number>`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
        })
        .from(schema.syncedTransactionEvents)
        .where(gte(schema.syncedTransactionEvents.syncedAt, monthStart));

      const kwhDay = Number(kwhStats.kwhDay);
      const kwhWeek = Number(kwhStats.kwhWeek);
      const kwhMonth = Number(kwhStats.kwhMonth);

      // Fetch sync success rates by all three timeframes in a single SQL query
      const [syncStats] = await db
        .select({
          dayTotal: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${todayIso} THEN 1 ELSE 0 END), 0)`,
          daySuccess: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${todayIso} AND ${schema.syncRuns.status} = 'completed' THEN 1 ELSE 0 END), 0)`,
          weekTotal: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${weekIso} THEN 1 ELSE 0 END), 0)`,
          weekSuccess: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${weekIso} AND ${schema.syncRuns.status} = 'completed' THEN 1 ELSE 0 END), 0)`,
          monthTotal: sql<number>`COALESCE(SUM(1), 0)`,
          monthSuccess: sql<number>`COALESCE(SUM(CASE WHEN ${schema.syncRuns.status} = 'completed' THEN 1 ELSE 0 END), 0)`,
        })
        .from(schema.syncRuns)
        .where(gte(schema.syncRuns.startedAt, monthStart));

      const calcRate = (success: number, total: number) =>
        total === 0 ? 100 : Math.round((success / total) * 100);

      const syncSuccessDay = calcRate(Number(syncStats.daySuccess), Number(syncStats.dayTotal));
      const syncSuccessWeek = calcRate(Number(syncStats.weekSuccess), Number(syncStats.weekTotal));
      const syncSuccessMonth = calcRate(Number(syncStats.monthSuccess), Number(syncStats.monthTotal));

      return new Response(
        JSON.stringify({
          tags: {
            active: activeTags,
            blocked: blockedTags,
          },
          lago: {
            customers: customerCount,
            subscriptions: subscriptionCount,
          },
          kwh: {
            day: kwhDay,
            week: kwhWeek,
            month: kwhMonth,
          },
          syncSuccess: {
            day: syncSuccessDay,
            week: syncSuccessWeek,
            month: syncSuccessMonth,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch dashboard stats", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch dashboard statistics" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
