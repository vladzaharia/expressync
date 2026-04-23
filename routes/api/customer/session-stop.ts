/**
 * POST /api/customer/session-stop
 *
 * Customer-friendly wrapper around `RemoteStopTransaction`. Body:
 *   { transactionId: number, chargeBoxId: string }
 *
 * Gates:
 *   - Authentication (middleware)
 *   - Capability `stop_charge` (active scope required)
 *   - Ownership of the transaction — verified by joining
 *     `synced_transaction_events` to `user_mappings` filtered by user_id.
 *     Returns 404 on miss.
 *   - Read-only impersonation: 403 for impersonating admins
 *
 * On success: persists a `charger_operation_log` row, dispatches RemoteStop,
 * returns `{ operationLogId, taskId, status }`.
 */

import { define } from "../../../utils.ts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { RemoteStopTransactionParamsSchema } from "../../../src/lib/types/steve.ts";
import { resolveCustomerScope } from "../../../src/lib/scoping.ts";
import {
  assertCapability,
  CapabilityDeniedError,
} from "../../../src/lib/capabilities.ts";
import { logCustomerAction } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerSessionStopAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only while impersonating; use admin tools to mutate.",
      });
    }

    let body: { transactionId?: unknown; chargeBoxId?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const { transactionId, chargeBoxId } = body;
    if (typeof transactionId !== "number" || !Number.isInteger(transactionId)) {
      return jsonResponse(400, { error: "transactionId must be an integer" });
    }
    if (typeof chargeBoxId !== "string" || chargeBoxId.length === 0) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }

    try {
      await assertCapability(ctx, "stop_charge");

      const scope = await resolveCustomerScope(ctx);
      if (scope.mappingIds.length === 0) {
        // Active capability holder must have at least one mapping; defense.
        return jsonResponse(404, { error: "Session not found" });
      }

      // Confirm the steve transaction id belongs to one of caller's mappings
      // by looking at `synced_transaction_events.steve_transaction_id`.
      const [owned] = await db
        .select({ id: schema.syncedTransactionEvents.id })
        .from(schema.syncedTransactionEvents)
        .where(
          and(
            eq(
              schema.syncedTransactionEvents.steveTransactionId,
              transactionId,
            ),
            inArray(
              schema.syncedTransactionEvents.userMappingId,
              scope.mappingIds,
            ),
          ),
        )
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .limit(1);
      if (!owned) {
        return jsonResponse(404, { error: "Session not found" });
      }

      const validated = RemoteStopTransactionParamsSchema.safeParse({
        chargeBoxId,
        transactionId,
      });
      if (!validated.success) {
        return jsonResponse(400, {
          error: "Invalid RemoteStop params",
          details: validated.error.issues,
        });
      }

      const [logRow] = await db
        .insert(schema.chargerOperationLog)
        .values({
          chargeBoxId,
          operation: "RemoteStopTransaction",
          params: validated.data,
          requestedByUserId: ctx.state.user.id,
          status: "pending",
        })
        .returning();

      try {
        const result = await steveClient.operations.remoteStop(validated.data);
        const [updated] = await db
          .update(schema.chargerOperationLog)
          .set({
            taskId: result.taskId,
            status: "submitted",
            result: result as unknown as Record<string, unknown>,
          })
          .where(eq(schema.chargerOperationLog.id, logRow.id))
          .returning();

        await logCustomerAction({
          userId: ctx.state.user.id,
          action: "session-stop",
          route: new URL(ctx.req.url).pathname,
          metadata: {
            operationLogId: updated.id,
            chargeBoxId,
            transactionId,
          },
        });

        return jsonResponse(200, {
          operationLogId: updated.id,
          taskId: updated.taskId,
          status: updated.status,
        });
      } catch (steveErr) {
        const message = steveErr instanceof Error
          ? steveErr.message
          : String(steveErr);
        log.error("StEvE RemoteStop failed", steveErr as Error);
        await db
          .update(schema.chargerOperationLog)
          .set({
            status: "failed",
            result: { error: message },
            completedAt: new Date(),
          })
          .where(eq(schema.chargerOperationLog.id, logRow.id));
        return jsonResponse(502, {
          operationLogId: logRow.id,
          status: "failed",
          error: "Charger could not stop the session. Please try again.",
        });
      }
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "Account inactive",
          capability: err.capability,
        });
      }
      log.error("Failed to dispatch session-stop", err as Error);
      return jsonResponse(500, { error: "Failed to stop charging" });
    }
  },
});
