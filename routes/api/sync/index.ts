import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { count, desc } from "drizzle-orm";

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
      const limit = parseInt(url.searchParams.get("limit") || "15");

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
      console.error("Failed to fetch sync runs:", error);
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
