import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { gte } from "drizzle-orm";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";

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
        console.error("Failed to fetch OCPP tags:", error);
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
        console.error("Failed to fetch Lago data:", error);
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

      // Fetch kWh delivered by timeframe
      const [dayEvents, weekEvents, monthEvents] = await Promise.all([
        db
          .select()
          .from(schema.syncedTransactionEvents)
          .where(gte(schema.syncedTransactionEvents.syncedAt, todayStart)),
        db
          .select()
          .from(schema.syncedTransactionEvents)
          .where(gte(schema.syncedTransactionEvents.syncedAt, weekStart)),
        db
          .select()
          .from(schema.syncedTransactionEvents)
          .where(gte(schema.syncedTransactionEvents.syncedAt, monthStart)),
      ]);

      const kwhDay = dayEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);
      const kwhWeek = weekEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);
      const kwhMonth = monthEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);

      // Fetch sync success rates by timeframe
      const [daySyncs, weekSyncs, monthSyncs] = await Promise.all([
        db
          .select()
          .from(schema.syncRuns)
          .where(gte(schema.syncRuns.startedAt, todayStart)),
        db
          .select()
          .from(schema.syncRuns)
          .where(gte(schema.syncRuns.startedAt, weekStart)),
        db
          .select()
          .from(schema.syncRuns)
          .where(gte(schema.syncRuns.startedAt, monthStart)),
      ]);

      const calculateSuccessRate = (syncs: typeof daySyncs) => {
        if (syncs.length === 0) return 100;
        const successful = syncs.filter((s) => s.status === "completed").length;
        return Math.round((successful / syncs.length) * 100);
      };

      const syncSuccessDay = calculateSuccessRate(daySyncs);
      const syncSuccessWeek = calculateSuccessRate(weekSyncs);
      const syncSuccessMonth = calculateSuccessRate(monthSyncs);

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
      console.error("Failed to fetch dashboard stats:", error);
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
