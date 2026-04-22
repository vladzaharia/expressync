import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { count, desc } from "drizzle-orm";
import { logger } from "../../../src/lib/utils/logger.ts";

/**
 * GET /api/sync
 *
 * Get paginated sync runs.
 * Query params:
 * - skip: number of items to skip (default: 0)
 * - limit: number of items to return (default: 15)
 *
 * Returns:
 * - items: array of sync runs
 * - total: total count of sync runs
 */
export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const skip = parseInt(url.searchParams.get("skip") || "0");
      if (isNaN(skip) || skip < 0) {
        return new Response(
          JSON.stringify({ error: "Invalid skip parameter" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      const limit = parseInt(url.searchParams.get("limit") || "15");
      if (isNaN(limit) || limit < 1 || limit > 100) {
        return new Response(
          JSON.stringify({ error: "Invalid limit parameter (1-100)" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Get total count
      const [{ value: total }] = await db
        .select({ value: count() })
        .from(schema.syncRuns);

      // Get paginated items
      const items = await db
        .select()
        .from(schema.syncRuns)
        .orderBy(desc(schema.syncRuns.startedAt))
        .offset(skip)
        .limit(limit);

      return new Response(
        JSON.stringify({
          items,
          total,
          skip,
          limit,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch sync runs", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch sync runs" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
