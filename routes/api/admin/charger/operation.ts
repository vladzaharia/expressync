import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { desc, eq } from "drizzle-orm";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import {
  ALLOWED_OPERATIONS,
  isAllowedOperation,
  type OcppOperationName,
  OPERATION_PARAM_SCHEMAS,
} from "../../../../src/lib/types/steve.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import { recordChargerStatus } from "../../../../src/services/charger-cache.service.ts";
import { eventBus } from "../../../../src/services/event-bus.service.ts";

/**
 * Map from allowed operation name to the corresponding `steveClient.operations`
 * method. Kept here so the route file is the single dispatch point and adding
 * a new allowed op requires touching one place.
 */
const OPERATION_DISPATCHERS: Record<
  OcppOperationName,
  // deno-lint-ignore no-explicit-any
  (params: any) => Promise<{ taskId: number }>
> = {
  RemoteStartTransaction: (p) => steveClient.operations.remoteStart(p),
  RemoteStopTransaction: (p) => steveClient.operations.remoteStop(p),
  UnlockConnector: (p) => steveClient.operations.unlockConnector(p),
  ReserveNow: (p) => steveClient.operations.reserveNow(p),
  CancelReservation: (p) => steveClient.operations.cancelReservation(p),
  TriggerMessage: (p) => steveClient.operations.triggerMessage(p),
  GetConfiguration: (p) => steveClient.operations.getConfiguration(p),
  GetCompositeSchedule: (p) => steveClient.operations.getCompositeSchedule(p),
  GetDiagnostics: (p) => steveClient.operations.getDiagnostics(p),
  GetLocalListVersion: (p) => steveClient.operations.getLocalListVersion(p),
  DataTransfer: (p) => steveClient.operations.dataTransfer(p),
  SetChargingProfile: (p) => steveClient.operations.setChargingProfile(p),
  ChangeAvailability: (p) => steveClient.operations.changeAvailability(p),
};

/**
 * POST /api/charger/operation
 *
 * Admin-guarded (see routes/_middleware.ts — /api/charger/* is in
 * ADMIN_ONLY_PATHS). Accepts:
 *   {
 *     chargeBoxId: string,
 *     operation: OcppOperationName,
 *     params: Record<string, unknown>,
 *     dryRun?: boolean
 *   }
 *
 * Behavior:
 *   1. Server-side allowlist check — reject any operation not in
 *      ALLOWED_OPERATIONS with 400 + clear message. This is a DOUBLE-GUARD
 *      so a crafted request bypassing the UI still gets blocked.
 *   2. Persist `charger_operation_log` row with status='pending' (or
 *      'dry_run' if dryRun=true) BEFORE calling StEvE — audit-first.
 *   3. If not dry-run, call the matching operations method; update row with
 *      task_id and status='submitted' on success, or status='failed' +
 *      error details in `result` on exception.
 *   4. Return the row id + task_id so the UI can poll status.
 *
 * Destructive ops (Reset, ClearCache, UpdateFirmware, SendLocalList,
 * ClearChargingProfile, ChangeConfiguration) are NOT in ALLOWED_OPERATIONS
 * and will be rejected here — use the StEvE admin UI instead.
 */
export const handler = define.handlers({
  /**
   * GET /api/charger/operation?chargeBoxId=...&limit=5
   *
   * Returns a compact list of recent operation log rows for the given
   * chargeBoxId, newest first. Used by the RecentOperationsStrip island.
   * Requires `chargeBoxId` — a site-wide listing would bypass admin audit
   * intent (use /admin/operation-log instead).
   */
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const chargeBoxId = url.searchParams.get("chargeBoxId");
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.max(
      1,
      Math.min(50, Number.parseInt(limitRaw ?? "10", 10) || 10),
    );

    if (!chargeBoxId) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }

    try {
      const rows = await db
        .select({
          id: schema.chargerOperationLog.id,
          operation: schema.chargerOperationLog.operation,
          status: schema.chargerOperationLog.status,
          taskId: schema.chargerOperationLog.taskId,
          createdAt: schema.chargerOperationLog.createdAt,
          completedAt: schema.chargerOperationLog.completedAt,
          result: schema.chargerOperationLog.result,
          requestedByEmail: schema.users.email,
        })
        .from(schema.chargerOperationLog)
        .leftJoin(
          schema.users,
          eq(schema.chargerOperationLog.requestedByUserId, schema.users.id),
        )
        .where(eq(schema.chargerOperationLog.chargeBoxId, chargeBoxId))
        .orderBy(desc(schema.chargerOperationLog.createdAt))
        .limit(limit);

      return jsonResponse(200, {
        rows: rows.map((r) => ({
          id: r.id,
          operation: r.operation,
          status: r.status,
          taskId: r.taskId,
          createdAt: r.createdAt ? r.createdAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          result: r.result ?? null,
          requestedByEmail: r.requestedByEmail ?? null,
        })),
      });
    } catch (error) {
      logger.error(
        "API",
        "Failed to list charger operation log rows",
        error as Error,
      );
      return jsonResponse(500, {
        error: "Failed to list operation log rows",
      });
    }
  },

  async POST(ctx) {
    // Defense-in-depth: this endpoint is mounted under /api/admin/* and the
    // middleware enforces admin-host-only delivery. We re-check the role here
    // so even if a future middleware refactor regresses, a customer-role
    // session can never dispatch arbitrary OCPP operations.
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(403, {
        error: "Forbidden — admin role required",
      });
    }

    let body: {
      chargeBoxId?: unknown;
      operation?: unknown;
      params?: unknown;
      dryRun?: unknown;
    };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { chargeBoxId, operation, params, dryRun } = body;

    // 1. Shape check
    if (typeof chargeBoxId !== "string" || chargeBoxId.length === 0) {
      return jsonResponse(400, {
        error: "chargeBoxId is required and must be a non-empty string",
      });
    }
    if (typeof operation !== "string") {
      return jsonResponse(400, { error: "operation is required" });
    }

    // 2. Server-side allowlist — the CRITICAL guard.
    if (!isAllowedOperation(operation)) {
      logger.warn("API", "Rejected disallowed OCPP operation", {
        operation,
        chargeBoxId,
        userId: ctx.state.user?.id,
      });
      return jsonResponse(400, {
        error:
          `Operation '${operation}' is not allowed. Destructive operations must be performed via the StEvE admin UI. Allowed operations: ${
            ALLOWED_OPERATIONS.join(", ")
          }`,
        allowedOperations: ALLOWED_OPERATIONS,
      });
    }

    // 3. Validate params against the op-specific schema. Inject chargeBoxId
    // so per-op schemas (which require it) pass.
    const opName = operation as OcppOperationName;
    const paramsObj =
      (params && typeof params === "object" && !Array.isArray(params))
        ? (params as Record<string, unknown>)
        : {};
    const paramsWithSelection = { chargeBoxId, ...paramsObj };
    const paramsSchema = OPERATION_PARAM_SCHEMAS[opName];
    const parsed = paramsSchema.safeParse(paramsWithSelection);
    if (!parsed.success) {
      return jsonResponse(400, {
        error: `Invalid params for ${opName}`,
        details: parsed.error.issues,
      });
    }
    const validatedParams = parsed.data;

    const isDryRun = dryRun === true;

    // 4. Audit-first insert (before StEvE call).
    let logRow: schema.ChargerOperationLog;
    try {
      const [inserted] = await db
        .insert(schema.chargerOperationLog)
        .values({
          chargeBoxId,
          operation: opName,
          params: validatedParams,
          requestedByUserId: ctx.state.user?.id ?? null,
          status: isDryRun ? "dry_run" : "pending",
        })
        .returning();
      logRow = inserted;
    } catch (error) {
      logger.error(
        "API",
        "Failed to insert charger_operation_log row",
        error as Error,
      );
      return jsonResponse(500, { error: "Failed to record operation" });
    }

    if (isDryRun) {
      logger.info("API", "Dry-run OCPP operation recorded", {
        operationLogId: logRow.id,
        operation: opName,
        chargeBoxId,
      });
      return jsonResponse(200, {
        operationLogId: logRow.id,
        taskId: null,
        status: "dry_run",
        dryRun: true,
      });
    }

    // 5. Call StEvE and update the row.
    try {
      const dispatch = OPERATION_DISPATCHERS[opName];
      const result = await dispatch(validatedParams);

      const [updated] = await db
        .update(schema.chargerOperationLog)
        .set({
          taskId: result.taskId,
          status: "submitted",
          result: result as unknown as Record<string, unknown>,
        })
        .where(eq(schema.chargerOperationLog.id, logRow.id))
        .returning();

      logger.info("API", "OCPP operation submitted", {
        operationLogId: updated.id,
        operation: opName,
        chargeBoxId,
        taskId: updated.taskId,
      });

      // On a successful TriggerMessage(StatusNotification) dispatch, poke the
      // sticky cache so `chargers_cache.last_status_at` advances immediately
      // instead of waiting for the async StatusNotification to arrive. A
      // single UPSERT — no read-modify-write — keeps us race-safe against
      // parallel polling. "Available" is a neutral placeholder; the real
      // status lands when the charger replies asynchronously.
      if (
        opName === "TriggerMessage" &&
        (validatedParams as { triggerMessage?: unknown }).triggerMessage ===
          "StatusNotification"
      ) {
        try {
          await recordChargerStatus(db, chargeBoxId, "Available");
        } catch (cacheErr) {
          logger.warn("API", "recordChargerStatus upsert failed", {
            chargeBoxId,
            error: cacheErr instanceof Error
              ? cacheErr.message
              : String(cacheErr),
          });
        }
        // Phase P7: publish charger.state so live-status consumers can react
        // immediately. Placeholder status mirrors what the cache stores until
        // the async StatusNotification lands.
        try {
          eventBus.publish({
            type: "charger.state",
            payload: {
              chargeBoxId,
              status: "Available",
              updatedAt: new Date().toISOString(),
            },
          });
        } catch (_pubErr) {
          // Non-fatal; cache upsert already succeeded.
        }
      }

      return jsonResponse(200, {
        operationLogId: updated.id,
        taskId: updated.taskId,
        status: updated.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("API", "OCPP operation failed at StEvE", {
        operationLogId: logRow.id,
        operation: opName,
        chargeBoxId,
        error: message,
      });
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
        error: message,
      });
    }
  },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
