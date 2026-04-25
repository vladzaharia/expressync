/**
 * POST /api/customer/remote-start
 *
 * Dashboard "Pick charger" remote-start. Body:
 *   { chargeBoxId: string, connectorId?: number }
 *
 * Differs from `/api/customer/scan-start` only in that we auto-select the
 * customer's primary active card (first active user_mapping) rather than
 * requiring the UI to pass `ocppTagPk`. The endpoint is intentionally
 * narrow — a user with >1 active card today just gets the first one;
 * multi-card picking still lives behind the full `StartChargingSheet`.
 *
 * Gates:
 *   - Authentication (middleware)
 *   - Capability `start_charge` (active scope required)
 *   - Read-only impersonation: admins acting-as get 403
 */

import { and, eq, inArray } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { RemoteStartTransactionParamsSchema } from "../../../src/lib/types/steve.ts";
import { resolveCustomerScope } from "../../../src/lib/scoping.ts";
import {
  assertCapability,
  CapabilityDeniedError,
} from "../../../src/lib/capabilities.ts";
import { logCustomerAction } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerRemoteStartAPI");

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

    let body: { chargeBoxId?: unknown; connectorId?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { chargeBoxId, connectorId } = body;
    if (typeof chargeBoxId !== "string" || chargeBoxId.length === 0) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }
    if (
      connectorId !== undefined &&
      (typeof connectorId !== "number" || !Number.isInteger(connectorId) ||
        connectorId < 0)
    ) {
      return jsonResponse(400, {
        error: "connectorId must be a non-negative integer",
      });
    }

    try {
      await assertCapability(ctx, "start_charge");

      const scope = await resolveCustomerScope(ctx);
      if (scope.mappingIds.length === 0) {
        return jsonResponse(404, { error: "No active card on file" });
      }

      // Pick the first active mapping as the primary card.
      const [mapping] = await db
        .select({
          id: schema.userMappings.id,
          steveOcppTagPk: schema.userMappings.steveOcppTagPk,
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
        })
        .from(schema.userMappings)
        .where(
          and(
            inArray(schema.userMappings.id, scope.mappingIds),
            eq(schema.userMappings.isActive, true),
          ),
        )
        .limit(1);
      if (!mapping) {
        return jsonResponse(404, { error: "No active card on file" });
      }

      const validated = RemoteStartTransactionParamsSchema.safeParse({
        chargeBoxId,
        connectorId,
        idTag: mapping.steveOcppIdTag,
      });
      if (!validated.success) {
        return jsonResponse(400, {
          error: "Invalid RemoteStart params",
          details: validated.error.issues,
        });
      }

      const [logRow] = await db
        .insert(schema.chargerOperationLog)
        .values({
          chargeBoxId,
          operation: "RemoteStartTransaction",
          params: validated.data,
          requestedByUserId: ctx.state.user.id,
          status: "pending",
        })
        .returning();

      try {
        const result = await steveClient.operations.remoteStart(validated.data);
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
          action: "remote-start",
          route: new URL(ctx.req.url).pathname,
          metadata: {
            operationLogId: updated.id,
            chargeBoxId,
            connectorId: connectorId ?? null,
            ocppTagPk: mapping.steveOcppTagPk,
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
        log.error("StEvE RemoteStart failed", steveErr as Error);
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
          error: "Charger could not start the session. Please try again.",
        });
      }
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "Account inactive",
          capability: err.capability,
        });
      }
      log.error("Failed to dispatch remote-start", err as Error);
      return jsonResponse(500, { error: "Failed to start charging" });
    }
  },
});
