/**
 * GET /api/customer/cards/[id]
 *
 * Single card detail with stats. `[id]` is the `user_mappings.id` (NOT the
 * StEvE PK). Ownership enforced via `assertOwnership("card", id)`.
 *
 * Stats: total kWh, total sessions, last-used timestamp; computed from
 * `synced_transaction_events` joined to this single mapping.
 */

import { define } from "../../../../utils.ts";
import { count, eq, max, sum } from "drizzle-orm";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import {
  assertOwnership,
  OwnershipError,
} from "../../../../src/lib/scoping.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerCardDetailAPI");

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
    const id = parseInt(ctx.params.id ?? "", 10);
    if (!Number.isFinite(id) || id <= 0) {
      return jsonResponse(400, { error: "Invalid id" });
    }

    try {
      await assertOwnership(ctx, "card", id);

      const [card] = await db
        .select({
          id: schema.userMappings.id,
          displayName: schema.userMappings.displayName,
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
          steveOcppTagPk: schema.userMappings.steveOcppTagPk,
          tagType: schema.userMappings.tagType,
          isActive: schema.userMappings.isActive,
          notes: schema.userMappings.notes,
          createdAt: schema.userMappings.createdAt,
          updatedAt: schema.userMappings.updatedAt,
        })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.id, id))
        .limit(1);

      if (!card) {
        // Should be unreachable; assertOwnership succeeded.
        return jsonResponse(404, { error: "Card not found" });
      }

      const [stats] = await db
        .select({
          totalKwh: sum(schema.syncedTransactionEvents.kwhDelta),
          totalSessions: count(schema.syncedTransactionEvents.id),
          lastUsedAt: max(schema.syncedTransactionEvents.syncedAt),
        })
        .from(schema.syncedTransactionEvents)
        .where(eq(schema.syncedTransactionEvents.userMappingId, id));

      return jsonResponse(200, {
        card: {
          id: card.id,
          displayName: card.displayName ?? null,
          ocppTagId: card.steveOcppIdTag,
          ocppTagPk: card.steveOcppTagPk,
          tagType: card.tagType,
          isActive: card.isActive,
          notes: card.notes ?? null,
          createdAt: card.createdAt?.toISOString() ?? null,
          updatedAt: card.updatedAt?.toISOString() ?? null,
          stats: {
            totalKwh: stats?.totalKwh ? Number(stats.totalKwh) : 0,
            totalSessions: Number(stats?.totalSessions ?? 0),
            lastUsedAt: stats?.lastUsedAt
              ? stats.lastUsedAt.toISOString()
              : null,
          },
        },
      });
    } catch (err) {
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Card not found" });
      }
      log.error("Failed to fetch card detail", err as Error);
      return jsonResponse(500, { error: "Failed to fetch card" });
    }
  },
});
