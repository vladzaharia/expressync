import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { logger } from "../../../../src/lib/utils/logger.ts";

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

      // Get paginated items with OCPP tag resolved via userMappings
      const rows = await db
        .select({
          event: schema.syncedTransactionEvents,
          ocppTag: schema.userMappings.steveOcppIdTag,
        })
        .from(schema.syncedTransactionEvents)
        .leftJoin(
          schema.userMappings,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .where(whereClause)
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .offset(skip)
        .limit(limit);

      const items = rows.map((row) => ({
        ...row.event,
        ocppTag: row.ocppTag ?? null,
      }));

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
      logger.error("API", "Failed to fetch transactions", error as Error);
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
