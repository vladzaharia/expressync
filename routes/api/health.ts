import { define } from "../../utils.ts";
import { db, syncRuns } from "../../src/db/index.ts";
import { desc, eq, and, lte, sql } from "drizzle-orm";
import { config } from "../../src/lib/config.ts";
import { logger } from "../../src/lib/utils/logger.ts";

type CheckStatus = "ok" | "degraded" | "unhealthy";

interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  lastRun?: string;
  error?: string;
}

/**
 * Health check endpoint for Docker
 * This endpoint is public (no authentication required)
 *
 * Checks database connectivity, external service configuration,
 * and sync health. Returns per-dependency status.
 */
export const handler = define.handlers({
  async GET(_ctx) {
    const checks: Record<string, CheckResult> = {};
    let overallStatus: CheckStatus = "ok";

    const degrade = (status: CheckStatus) => {
      if (status === "unhealthy") overallStatus = "unhealthy";
      else if (status === "degraded" && overallStatus !== "unhealthy") overallStatus = "degraded";
    };

    // Database connectivity check
    try {
      const start = performance.now();
      await db.execute(sql`SELECT 1`);
      const latencyMs = Math.round(performance.now() - start);
      checks.database = { status: "ok", latencyMs };
    } catch (error) {
      logger.error("Health", "Database check failed", error as Error);
      checks.database = { status: "unhealthy", error: (error as Error).message };
      degrade("unhealthy");
    }

    // StEvE API configuration check
    if (config.STEVE_API_URL && config.STEVE_API_KEY) {
      checks.steve = { status: "ok" };
    } else {
      checks.steve = { status: "degraded", error: "StEvE API not configured" };
      degrade("degraded");
    }

    // Lago API configuration check
    if (config.LAGO_API_URL && config.LAGO_API_KEY) {
      checks.lago = { status: "ok" };
    } else {
      checks.lago = { status: "degraded", error: "Lago API not configured" };
      degrade("degraded");
    }

    // Sync health check - look for stale locks (running > 30 min)
    try {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

      const staleSyncs = await db
        .select()
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.status, "running"),
            lte(syncRuns.startedAt, thirtyMinAgo),
          ),
        );

      const [lastSync] = await db
        .select()
        .from(syncRuns)
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);

      if (staleSyncs.length > 0) {
        checks.sync = {
          status: "degraded",
          lastRun: lastSync?.startedAt?.toISOString(),
          error: `${staleSyncs.length} sync(s) running > 30 minutes`,
        };
        degrade("degraded");
      } else {
        checks.sync = {
          status: "ok",
          lastRun: lastSync?.startedAt?.toISOString(),
        };
      }
    } catch (error) {
      logger.error("Health", "Sync check failed", error as Error);
      checks.sync = { status: "unhealthy", error: (error as Error).message };
      degrade("unhealthy");
    }

    const httpStatus = overallStatus === "unhealthy" ? 503 : 200;

    return new Response(
      JSON.stringify({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks,
      }),
      {
        status: httpStatus,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});
