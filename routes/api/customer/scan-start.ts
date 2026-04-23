/**
 * POST /api/customer/scan-start
 *
 * Customer-friendly wrapper around `RemoteStartTransaction`. Body:
 *   { chargeBoxId: string, connectorId?: number, ocppTagPk: number }
 *
 * Gates:
 *   - Authentication (middleware)
 *   - Capability `start_charge` (active scope required)
 *   - Ownership of `ocppTagPk` (cards == tags)
 *   - Read-only impersonation: admins acting-as get 403 here
 *
 * On success: persists a `charger_operation_log` row (audit-first), then
 * dispatches the OCPP RemoteStart via StEvE. Returns
 * `{ operationLogId, taskId, status }`. Failure modes mirror the admin
 * dispatcher.
 *
 * The legacy admin endpoint at `/api/admin/charger/operation` keeps the full
 * allowlist — customers never reach it (middleware enforces the surface
 * gate). The intent of this wrapper is to keep the customer audit trail
 * separate (`auth_audit.event='customer.action'`) and the body shape narrow.
 */

import { define } from "../../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { RemoteStartTransactionParamsSchema } from "../../../src/lib/types/steve.ts";
import { assertOwnership, OwnershipError } from "../../../src/lib/scoping.ts";
import {
  assertCapability,
  CapabilityDeniedError,
} from "../../../src/lib/capabilities.ts";
import { logCustomerAction } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerScanStartAPI");

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

    let body: {
      chargeBoxId?: unknown;
      connectorId?: unknown;
      ocppTagPk?: unknown;
    };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { chargeBoxId, connectorId, ocppTagPk } = body;
    if (typeof chargeBoxId !== "string" || chargeBoxId.length === 0) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }
    if (typeof ocppTagPk !== "number" || !Number.isInteger(ocppTagPk)) {
      return jsonResponse(400, { error: "ocppTagPk must be an integer" });
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
      await assertOwnership(ctx, "card", ocppTagPk);

      // Resolve the OCPP id_tag string from the mapping.
      const [mapping] = await db
        .select({ steveOcppIdTag: schema.userMappings.steveOcppIdTag })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.steveOcppTagPk, ocppTagPk))
        .limit(1);
      if (!mapping) {
        return jsonResponse(404, { error: "Card not found" });
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

      // Audit-first row insert.
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
          action: "scan-start",
          route: new URL(ctx.req.url).pathname,
          metadata: {
            operationLogId: updated.id,
            chargeBoxId,
            connectorId: connectorId ?? null,
            ocppTagPk,
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
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Card not found" });
      }
      log.error("Failed to dispatch scan-start", err as Error);
      return jsonResponse(500, { error: "Failed to start charging" });
    }
  },
});
