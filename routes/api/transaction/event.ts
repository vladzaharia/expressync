import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { and, desc, gte, lte } from "drizzle-orm";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");

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

      const events = await db
        .select()
        .from(schema.syncedTransactionEvents)
        .where(whereClause)
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .limit(1000);

      return new Response(JSON.stringify(events), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch transaction events" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
