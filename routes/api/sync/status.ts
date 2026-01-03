import { define } from "../../../utils.ts";
import { db, syncRuns } from "../../../src/db/index.ts";
import { desc } from "drizzle-orm";

/**
 * GET /api/sync/status
 *
 * Get the status of recent sync runs.
 * Returns the last 10 sync runs with their statistics.
 */
export const handler = define.handlers({
  async GET(_req) {
    try {
      const recentSyncs = await db
        .select()
        .from(syncRuns)
        .orderBy(desc(syncRuns.startedAt))
        .limit(10);

      // Parse errors from JSON strings
      const syncsWithParsedErrors = recentSyncs.map((sync) => ({
        ...sync,
        errors: sync.errors ? JSON.parse(sync.errors) : [],
      }));

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            recentSyncs: syncsWithParsedErrors,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("[API] Failed to get sync status:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: (error as Error).message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
});

