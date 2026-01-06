import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { and, count, desc, gte, lte } from "drizzle-orm";

/**
 * GET /api/transaction
 *
 * Get paginated transaction events.
 * Query params:
 * - skip: number of items to skip (default: 0)
 * - limit: number of items to return (default: 15)
 * - start: filter by start date (ISO string)
 * - end: filter by end date (ISO string)
 *
 * Returns:
 * - items: array of transaction events
 * - total: total count of transaction events (matching filters)
 */
export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const skip = parseInt(url.searchParams.get("skip") || "0");
      const limit = parseInt(url.searchParams.get("limit") || "15");
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");

      // Build filter conditions
      const conditions = [];
      if (start) {
        conditions.push(
          gte(schema.syncedTransactionEvents.syncedAt, new Date(start)),
        );
      }
      if (end) {
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        conditions.push(
          lte(schema.syncedTransactionEvents.syncedAt, endDate),
        );
      }

      const whereClause = conditions.length > 0
        ? and(...conditions)
        : undefined;

      // Get total count (with filters)
      const [{ value: total }] = await db
        .select({ value: count() })
        .from(schema.syncedTransactionEvents)
        .where(whereClause);

      // Get paginated items
      const items = await db
        .select()
        .from(schema.syncedTransactionEvents)
        .where(whereClause)
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
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
      console.error("Failed to fetch transactions:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch transactions" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
