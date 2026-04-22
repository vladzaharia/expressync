import { define } from "../../../../utils.ts";
import { db, syncRuns } from "../../../../src/db/index.ts";
import { desc } from "drizzle-orm";
import { logger } from "../../../../src/lib/utils/logger.ts";

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
      const items = recentSyncs.map((sync) => {
        let parsedErrors: unknown[] = [];
        if (sync.errors) {
          try {
            parsedErrors = JSON.parse(sync.errors);
          } catch {
            parsedErrors = [{ raw: sync.errors }];
          }
        }
        return { ...sync, errors: parsedErrors };
      });

      return new Response(
        JSON.stringify(items),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to get sync status", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to get sync status" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
