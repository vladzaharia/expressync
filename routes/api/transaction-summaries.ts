import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc, sql, eq, count } from "drizzle-orm";

// Transaction summary type for the table
export interface TransactionSummary {
  id: number;
  steveTransactionId: number;
  ocppTagId: string | null;
  totalKwhBilled: number;
  isFinalized: boolean;
  lastSyncedAt: Date | null;
  eventCount: number;
}

/**
 * GET /api/transaction-summaries
 *
 * Get paginated transaction summaries.
 * Query params:
 * - skip: number of items to skip (default: 0)
 * - limit: number of items to return (default: 15)
 *
 * Returns:
 * - items: array of transaction summaries
 * - total: total count of transactions
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
        .from(schema.transactionSyncState);

      // Get paginated transactions
      const transactions = await db
        .select({
          id: schema.transactionSyncState.id,
          steveTransactionId: schema.transactionSyncState.steveTransactionId,
          totalKwhBilled: schema.transactionSyncState.totalKwhBilled,
          isFinalized: schema.transactionSyncState.isFinalized,
          updatedAt: schema.transactionSyncState.updatedAt,
        })
        .from(schema.transactionSyncState)
        .orderBy(desc(schema.transactionSyncState.updatedAt))
        .offset(skip)
        .limit(limit);

      // Get event counts and OCPP tags for each transaction
      const items: TransactionSummary[] = await Promise.all(
        transactions.map(async (tx) => {
          const events = await db
            .select({
              count: sql<number>`count(*)`,
              ocppTagId: schema.syncedTransactionEvents.ocppTagId,
              lastSyncedAt: sql<Date>`max(${schema.syncedTransactionEvents.syncedAt})`,
            })
            .from(schema.syncedTransactionEvents)
            .where(eq(schema.syncedTransactionEvents.steveTransactionId, tx.steveTransactionId))
            .groupBy(schema.syncedTransactionEvents.ocppTagId);

          const firstEvent = events[0];
          return {
            id: tx.id,
            steveTransactionId: tx.steveTransactionId,
            ocppTagId: firstEvent?.ocppTagId ?? null,
            totalKwhBilled: tx.totalKwhBilled ?? 0,
            isFinalized: tx.isFinalized ?? false,
            lastSyncedAt: firstEvent?.lastSyncedAt ?? tx.updatedAt,
            eventCount: Number(firstEvent?.count ?? 0),
          };
        })
      );

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
      console.error("Failed to fetch transaction summaries:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch transaction summaries" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});

