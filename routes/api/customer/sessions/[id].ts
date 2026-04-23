/**
 * GET /api/customer/sessions/[id]
 *
 * Single session detail (with meter timeline). Caller must own the session
 * via `synced_transaction_events.user_mapping_id IN scope.mappingIds`.
 *
 * `assertOwnership("session", id)` runs first so non-owners get 404 (not
 * 403) — preventing enumeration via the existence-vs-permission oracle.
 */

import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { and, asc, eq } from "drizzle-orm";
import {
  assertOwnership,
  OwnershipError,
} from "../../../../src/lib/scoping.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerSessionDetailAPI");

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
      // 404 by design on non-owned ids.
      await assertOwnership(ctx, "session", id);

      const [event] = await db
        .select({
          event: schema.syncedTransactionEvents,
          ocppTag: schema.userMappings.steveOcppIdTag,
          mappingDisplayName: schema.userMappings.displayName,
        })
        .from(schema.syncedTransactionEvents)
        .leftJoin(
          schema.userMappings,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .where(eq(schema.syncedTransactionEvents.id, id))
        .limit(1);

      if (!event) {
        // Should be unreachable given assertOwnership succeeded, but keep
        // for forward-compat (race against deletion).
        return jsonResponse(404, { error: "Session not found" });
      }

      // Meter timeline: every event sharing the same StEvE transaction id.
      // Filtered to the same user_mapping_id for defense-in-depth.
      const timeline = await db
        .select()
        .from(schema.syncedTransactionEvents)
        .where(
          and(
            eq(
              schema.syncedTransactionEvents.steveTransactionId,
              event.event.steveTransactionId,
            ),
            eq(
              schema.syncedTransactionEvents.userMappingId,
              event.event.userMappingId!,
            ),
          ),
        )
        .orderBy(asc(schema.syncedTransactionEvents.syncedAt));

      return jsonResponse(200, {
        session: {
          ...event.event,
          ocppTag: event.ocppTag ?? null,
          mappingDisplayName: event.mappingDisplayName ?? null,
        },
        meterTimeline: timeline,
      });
    } catch (err) {
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Session not found" });
      }
      log.error("Failed to fetch session detail", err as Error);
      return jsonResponse(500, { error: "Failed to fetch session" });
    }
  },
});
