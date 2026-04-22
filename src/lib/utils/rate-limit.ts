/**
 * Rate limiting utilities
 *
 * Postgres-backed fixed-window rate limiter (Phase A7a).
 *
 * Previously this module used a process-local `Map`, which made limits leak
 * between tests, reset on every deploy, and fail to coordinate across
 * multiple app instances. This implementation persists each (key, window)
 * bucket in the `rate_limits` table and increments via UPSERT, so limits
 * hold across restarts and multiple instances.
 *
 * Cleanup of stale rows is owned by a 2-minute cron job in `sync-worker.ts`.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { rateLimits } from "../../db/schema.ts";

// Rate limiting configuration
export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Check rate limit for a given key.
 *
 * Returns `true` when the request is allowed, `false` when blocked.
 * On database errors we fail OPEN (allow the request) so a transient DB
 * hiccup never takes the whole app offline — the error is logged for ops.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(
    Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS,
  );

  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: {
          count: sql`${rateLimits.count} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ count: rateLimits.count });

    if (row.count > maxRequests) {
      logMetric("rate_limit_blocks", 1, { key });
      return false;
    }
    logMetric("rate_limit_hits", 1, { key });
    return true;
  } catch (err) {
    logMetric("rate_limit_store_error", 1, { error: String(err) });
    console.error("rate_limit_store_error:", err);
    // Fail OPEN — never block real users on a transient DB issue.
    return true;
  }
}

function logMetric(
  metric: string,
  value: number,
  tags: Record<string, string>,
): void {
  console.log(
    JSON.stringify({
      level: "info",
      metric,
      value,
      tags,
      ts: Date.now(),
    }),
  );
}
