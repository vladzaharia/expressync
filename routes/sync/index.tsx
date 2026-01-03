import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc } from "drizzle-orm";
import SyncControls from "../../islands/SyncControls.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const syncRuns = await db
      .select()
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(20);

    return { data: { syncRuns } };
  },
});

export default define.page<typeof handler>(function SyncPage({ data }) {
  return (
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">Sync Status</h1>
        <SyncControls />
      </div>

      <div class="bg-white shadow rounded-lg overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium">Started</th>
              <th class="px-6 py-3 text-left text-xs font-medium">Completed</th>
              <th class="px-6 py-3 text-left text-xs font-medium">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium">
                Transactions
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium">Events</th>
              <th class="px-6 py-3 text-left text-xs font-medium">Error</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            {data.syncRuns.map((run) => (
              <tr key={run.id}>
                <td class="px-6 py-4 text-sm">
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td class="px-6 py-4 text-sm">
                  {run.completedAt
                    ? new Date(run.completedAt).toLocaleString()
                    : "-"}
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
                <td class="px-6 py-4 text-sm text-red-600">
                  {run.errorMessage || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

