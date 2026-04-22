import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { desc, eq } from "drizzle-orm";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/sync/state
 *
 * Returns the adaptive scheduler's current state + a preview of transaction
 * sync state for the UI.
 *
 * Response shape:
 * {
 *   currentTier: "active"|"idle"|"dormant",
 *   nextRunAt: ISO | null,
 *   lastActivityAt: ISO | null,
 *   lastEvaluatedAt: ISO | null,
 *   // admin-only:
 *   pinnedUntil: ISO | null,
 *   pinnedTier: string | null,
 *   recentTransitions: Last20SchedulingLogs[],
 *   // backwards compat:
 *   transactionSyncState: row[]
 * }
 */
export const handler = define.handlers({
  async GET(ctx) {
    const isAdmin = ctx.state.user?.role === "admin";

    try {
      const [scheduleRow] = await db
        .select()
        .from(schema.syncScheduleState)
        .where(eq(schema.syncScheduleState.id, 1))
        .limit(1);

      // Transaction sync state preserved for existing consumers of this route.
      const transactionSyncState = await db.select().from(
        schema.transactionSyncState,
      );

      const basePayload: Record<string, unknown> = {
        currentTier: scheduleRow?.currentTier ?? "idle",
        nextRunAt: scheduleRow?.nextRunAt?.toISOString() ?? null,
        lastActivityAt: scheduleRow?.lastActivityAt?.toISOString() ?? null,
        lastEvaluatedAt: scheduleRow?.lastEvaluatedAt?.toISOString() ?? null,
        consecutiveIdleTicks: scheduleRow?.consecutiveIdleTicks ?? 0,
        transactionSyncState,
      };

      if (isAdmin) {
        const recentTransitions = await db
          .select({
            id: schema.syncRunLogs.id,
            syncRunId: schema.syncRunLogs.syncRunId,
            level: schema.syncRunLogs.level,
            message: schema.syncRunLogs.message,
            context: schema.syncRunLogs.context,
            createdAt: schema.syncRunLogs.createdAt,
          })
          .from(schema.syncRunLogs)
          .where(eq(schema.syncRunLogs.segment, "scheduling"))
          .orderBy(desc(schema.syncRunLogs.createdAt))
          .limit(20);

        basePayload.pinnedUntil = scheduleRow?.pinnedUntil?.toISOString() ??
          null;
        basePayload.pinnedTier = scheduleRow?.pinnedTier ?? null;
        basePayload.recentTransitions = recentTransitions.map((row) => ({
          ...row,
          createdAt: row.createdAt?.toISOString() ?? null,
        }));
      }

      return new Response(JSON.stringify(basePayload), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to fetch sync state", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch sync state" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
