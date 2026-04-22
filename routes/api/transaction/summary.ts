import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import { logger } from "../../../src/lib/utils/logger.ts";

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
 * GET /api/transaction/summary
 *
 * Get paginated transaction summaries.
 * Query params:
 * - skip: number of items to skip (default: 0)
 * - limit: number of items to return (default: 15)
 * - status: "active" | "completed" | "all" (default: all)
 * - from: ISO date (inclusive)
 * - to: ISO date (inclusive)
 * - tag: substring match against user_mappings.steveOcppIdTag
 *
 * Returns:
 * - items: array of transaction summaries
 * - total: total count of transactions (after filters)
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

      const statusParam = url.searchParams.get("status") ?? "all";
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const tag = url.searchParams.get("tag") ?? "";

      const conditions: SQL[] = [];
      if (statusParam === "active") {
        conditions.push(eq(schema.transactionSyncState.isFinalized, false));
      } else if (statusParam === "completed") {
        conditions.push(eq(schema.transactionSyncState.isFinalized, true));
      }
      if (from) {
        conditions.push(
          gte(schema.transactionSyncState.updatedAt, new Date(from)),
        );
      }
      if (to) {
        conditions.push(
          lte(
            schema.transactionSyncState.updatedAt,
            new Date(to + "T23:59:59"),
          ),
        );
      }
      if (tag) {
        conditions.push(
          ilike(schema.userMappings.steveOcppIdTag, `%${tag}%`),
        );
      }
      const whereClause = conditions.length > 0
        ? and(...conditions)
        : undefined;
      const needsTagJoin = Boolean(tag);

      // Get total count (filtered)
      const countBase = db
        .select({
          value: needsTagJoin
            ? countDistinct(schema.transactionSyncState.id)
            : count(),
        })
        .from(schema.transactionSyncState);
      const countWithJoins = needsTagJoin
        ? countBase
          .leftJoin(
            schema.syncedTransactionEvents,
            eq(
              schema.transactionSyncState.steveTransactionId,
              schema.syncedTransactionEvents.steveTransactionId,
            ),
          )
          .leftJoin(
            schema.userMappings,
            eq(
              schema.syncedTransactionEvents.userMappingId,
              schema.userMappings.id,
            ),
          )
        : countBase;
      const totalRows = whereClause
        ? await countWithJoins.where(whereClause)
        : await countWithJoins;
      const total = Number(totalRows[0]?.value ?? 0);

      // Get paginated transactions with event counts, OCPP tags, and last synced times
      // via a single JOIN query instead of N+1 queries
      const baseQuery = db
        .select({
          id: schema.transactionSyncState.id,
          steveTransactionId: schema.transactionSyncState.steveTransactionId,
          totalKwhBilled: schema.transactionSyncState.totalKwhBilled,
          isFinalized: schema.transactionSyncState.isFinalized,
          updatedAt: schema.transactionSyncState.updatedAt,
          eventCount: sql<
            number
          >`COALESCE(COUNT(${schema.syncedTransactionEvents.id}), 0)`,
          lastSyncedAt: sql<
            Date
          >`MAX(${schema.syncedTransactionEvents.syncedAt})`,
          ocppTagId: sql<
            string | null
          >`MIN(${schema.userMappings.steveOcppIdTag})`,
        })
        .from(schema.transactionSyncState)
        .leftJoin(
          schema.syncedTransactionEvents,
          eq(
            schema.transactionSyncState.steveTransactionId,
            schema.syncedTransactionEvents.steveTransactionId,
          ),
        )
        .leftJoin(
          schema.userMappings,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        );
      const filteredQuery = whereClause
        ? baseQuery.where(whereClause)
        : baseQuery;
      const items: TransactionSummary[] = (
        await filteredQuery
          .groupBy(
            schema.transactionSyncState.id,
            schema.transactionSyncState.steveTransactionId,
            schema.transactionSyncState.totalKwhBilled,
            schema.transactionSyncState.isFinalized,
            schema.transactionSyncState.updatedAt,
          )
          .orderBy(desc(schema.transactionSyncState.updatedAt))
          .offset(skip)
          .limit(limit)
      ).map((row) => ({
        id: row.id,
        steveTransactionId: row.steveTransactionId,
        ocppTagId: row.ocppTagId ?? null,
        totalKwhBilled: Number(row.totalKwhBilled) || 0,
        isFinalized: row.isFinalized ?? false,
        lastSyncedAt: row.lastSyncedAt ?? row.updatedAt,
        eventCount: Number(row.eventCount),
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
      logger.error(
        "API",
        "Failed to fetch transaction summaries",
        error as Error,
      );
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
