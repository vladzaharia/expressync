import { define } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { desc, gte } from "drizzle-orm";
import DashboardStats from "../islands/DashboardStats.tsx";

interface DashboardData {
  stats: {
    totalMappings: number;
    activeMappings: number;
    todayTransactions: number;
    todayKwh: number;
    weekTransactions: number;
    weekKwh: number;
  };
  recentSyncRuns: Array<{
    id: number;
    startedAt: Date;
    status: string;
    transactionsProcessed: number;
    eventsCreated: number;
  }>;
}

export const handler = define.handlers({
  async GET(ctx) {
    // Get mapping counts
    const mappings = await db.select().from(schema.userMappings);
    const totalMappings = mappings.length;
    const activeMappings = mappings.filter((m) => m.isActive).length;

    // Get today's billing events
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayEvents = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, today));

    const todayTransactions = todayEvents.length;
    const todayKwh = todayEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);

    // Get week's billing events
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weekEvents = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, weekAgo));

    const weekTransactions = weekEvents.length;
    const weekKwh = weekEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);

    // Get recent sync runs
    const recentSyncRuns = await db
      .select()
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(5);

    return {
      data: {
        stats: {
          totalMappings,
          activeMappings,
          todayTransactions,
          todayKwh,
          weekTransactions,
          weekKwh,
        },
        recentSyncRuns,
      },
    };
  },
});

export default define.page<typeof handler>(function DashboardPage({ data }) {
  return (
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Dashboard</h1>

      <DashboardStats stats={data.stats} />

      <div class="mt-8">
        <h2 class="text-xl font-semibold mb-4">Recent Sync Runs</h2>
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium">Time</th>
                <th class="px-6 py-3 text-left text-xs font-medium">Status</th>
                <th class="px-6 py-3 text-left text-xs font-medium">
                  Processed
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium">Events</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              {data.recentSyncRuns.map((run) => (
                <tr key={run.id}>
                  <td class="px-6 py-4 text-sm">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                  <td class="px-6 py-4 text-sm">
                    <span
                      class={`px-2 py-1 text-xs rounded ${
                        run.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : run.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-sm">{run.transactionsProcessed}</td>
                  <td class="px-6 py-4 text-sm">{run.eventsCreated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
