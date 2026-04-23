/**
 * GET /api/customer/cards
 *
 * Returns the caller's tags ("cards") with denormalized stats:
 *   id (mapping id), displayName, ocppTagId, ocppTagPk, isActive,
 *   tagType, lastUsedAt, sessionCount.
 *
 * `id` is the `user_mappings.id` (canonical card id used by `[id]` routes).
 * Inactive cards are included so the UI can render them with a gray badge —
 * the spec calls this out in the lifecycle section.
 *
 * Stats join `synced_transaction_events` filtered to mappings owned by the
 * caller. A pre-computed query short-circuits to an empty list when scope
 * has no mappings.
 */

import { define } from "../../../../utils.ts";
import { count, desc, eq, max, sum } from "drizzle-orm";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { resolveCustomerScope } from "../../../../src/lib/scoping.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerCardsAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    try {
      const scope = await resolveCustomerScope(ctx);
      if (scope.mappingIds.length === 0) {
        return jsonResponse(200, { cards: [] });
      }

      // One query joins mappings + their session stats. LEFT JOIN so
      // mappings with zero sessions still appear with sessionCount=0.
      const rows = await db
        .select({
          id: schema.userMappings.id,
          displayName: schema.userMappings.displayName,
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
          steveOcppTagPk: schema.userMappings.steveOcppTagPk,
          tagType: schema.userMappings.tagType,
          isActive: schema.userMappings.isActive,
          createdAt: schema.userMappings.createdAt,
          sessionCount: count(schema.syncedTransactionEvents.id),
          lastUsedAt: max(schema.syncedTransactionEvents.syncedAt),
          totalKwh: sum(schema.syncedTransactionEvents.kwhDelta),
        })
        .from(schema.userMappings)
        .leftJoin(
          schema.syncedTransactionEvents,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .where(
          eq(
            schema.userMappings.userId,
            ctx.state.actingAs ?? ctx.state.user.id,
          ),
        )
        .groupBy(schema.userMappings.id)
        .orderBy(
          desc(schema.userMappings.isActive),
          desc(schema.userMappings.createdAt),
        );

      const cards = rows.map((r) => ({
        id: r.id,
        displayName: r.displayName ?? null,
        ocppTagId: r.steveOcppIdTag,
        ocppTagPk: r.steveOcppTagPk,
        tagType: r.tagType,
        isActive: r.isActive,
        createdAt: r.createdAt?.toISOString() ?? null,
        sessionCount: Number(r.sessionCount ?? 0),
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        totalKwh: r.totalKwh ? Number(r.totalKwh) : 0,
      }));

      return jsonResponse(200, { cards });
    } catch (error) {
      log.error("Failed to list customer cards", error as Error);
      return jsonResponse(500, { error: "Failed to list cards" });
    }
  },
});
