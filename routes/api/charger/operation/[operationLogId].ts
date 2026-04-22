import { desc, eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { chargerOperationLog, users } from "../../../../src/db/schema.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/charger/operation/[operationLogId]
 *
 * Admin-guarded by `/api/charger/*` in routes/_middleware.ts. Returns the
 * current state of a single `charger_operation_log` row so the client-side
 * RemoteActionsPanel can poll for `pending → submitted → success / failed /
 * timeout / dry_run / completed` transitions.
 *
 * The id in the URL is treated as the `charger_operation_log.id` primary key
 * (what the POST handler returns as `operationLogId`). If no row matches by
 * PK, we fall back to `task_id` — historically some callers polled by StEvE
 * taskId; this keeps them working without another endpoint.
 *
 * Shape is deliberately flat — no deep joins — so the poller can diff on
 * `status`, `taskId`, `result`, `completedAt` alone.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const raw = ctx.params.operationLogId;
    const id = Number.parseInt(raw ?? "", 10);

    if (!Number.isFinite(id) || id <= 0) {
      return jsonResponse(400, {
        error: "operationLogId must be a positive integer",
      });
    }

    try {
      // Primary lookup: by PK.
      let rows = await db
        .select({
          id: chargerOperationLog.id,
          chargeBoxId: chargerOperationLog.chargeBoxId,
          operation: chargerOperationLog.operation,
          params: chargerOperationLog.params,
          taskId: chargerOperationLog.taskId,
          status: chargerOperationLog.status,
          result: chargerOperationLog.result,
          createdAt: chargerOperationLog.createdAt,
          completedAt: chargerOperationLog.completedAt,
          requestedByUserId: chargerOperationLog.requestedByUserId,
          requestedByEmail: users.email,
        })
        .from(chargerOperationLog)
        .leftJoin(users, eq(chargerOperationLog.requestedByUserId, users.id))
        .where(eq(chargerOperationLog.id, id))
        .limit(1);

      // Fallback: by task_id (in case the caller polled with a StEvE taskId).
      if (rows.length === 0) {
        rows = await db
          .select({
            id: chargerOperationLog.id,
            chargeBoxId: chargerOperationLog.chargeBoxId,
            operation: chargerOperationLog.operation,
            params: chargerOperationLog.params,
            taskId: chargerOperationLog.taskId,
            status: chargerOperationLog.status,
            result: chargerOperationLog.result,
            createdAt: chargerOperationLog.createdAt,
            completedAt: chargerOperationLog.completedAt,
            requestedByUserId: chargerOperationLog.requestedByUserId,
            requestedByEmail: users.email,
          })
          .from(chargerOperationLog)
          .leftJoin(users, eq(chargerOperationLog.requestedByUserId, users.id))
          .where(eq(chargerOperationLog.taskId, id))
          .orderBy(desc(chargerOperationLog.createdAt))
          .limit(1);
      }

      const row = rows[0];
      if (!row) {
        return jsonResponse(404, { error: "Operation log entry not found" });
      }

      return jsonResponse(200, {
        id: row.id,
        chargeBoxId: row.chargeBoxId,
        operation: row.operation,
        params: row.params,
        taskId: row.taskId,
        status: row.status,
        result: row.result,
        createdAt: row.createdAt ? row.createdAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        requestedByEmail: row.requestedByEmail ?? null,
      });
    } catch (error) {
      logger.error(
        "ChargerOperationPoll",
        "Failed to load operation log row",
        error as Error,
      );
      return jsonResponse(500, {
        error: "Failed to load operation log entry",
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
