#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * OCPP Billing Sync Worker
 *
 * This is a dedicated service that runs the sync process on a schedule.
 * It uses Croner for reliable, production-ready cron scheduling, driven by
 * the adaptive SyncScheduler (Phase C) — cadence shifts between 15m / 1h /
 * weekly based on observed activity.
 *
 * Architecture:
 * - Runs as a separate Docker container
 * - Shares database with main app
 * - Uses Croner for scheduling (stable, no unstable flags)
 * - Prevents overlapping executions
 * - Listens for manual trigger notifications via PostgreSQL LISTEN/NOTIFY
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read sync-worker.ts
 */

import postgres from "postgres";
import { Cron } from "croner";
import { sql } from "drizzle-orm";
import { config, validateSyncWorkerConfig } from "./src/lib/config.ts";
import { runSync, type SyncResult } from "./src/services/sync.service.ts";
import { SyncScheduler } from "./src/services/sync-scheduler.ts";
import { ensureLagoMetricSafety } from "./src/services/lago-safety.service.ts";
import { resolvePendingReservations } from "./src/services/reservation-resolver.service.ts";
import { pruneExpiredIdempotencyKeys } from "./src/lib/idempotency.ts";
import { db } from "./src/db/index.ts";
import {
  authAudit,
  deviceLogs,
  magicLinkAudit,
  rateLimits,
  verifications,
} from "./src/db/schema.ts";

// Validate configuration on startup
console.log("[Sync Worker] Starting OCPP Billing Sync Worker...");
if (config.SYNC_CRON_SCHEDULE && config.SYNC_CRON_SCHEDULE.trim()) {
  console.log(
    `[Sync Worker] SYNC_CRON_SCHEDULE override active: ${config.SYNC_CRON_SCHEDULE}`,
  );
} else {
  console.log(
    "[Sync Worker] Using adaptive cadence (active 15m / idle 1h / dormant weekly)",
  );
}

try {
  validateSyncWorkerConfig();
  console.log("[Sync Worker] Configuration validated successfully");
} catch (error) {
  console.error("[Sync Worker] Configuration validation failed:", error);
  Deno.exit(1);
}

// Phase D: verify Lago billable metric aggregation type is sum_agg; degrades
// enrichment silently if not. Fire-and-forget — never blocks worker startup.
ensureLagoMetricSafety().catch(() => {/* already logged */});

// Track if a sync is currently running (for additional safety)
let isSyncing = false;

// Track if shutdown is in progress (prevents reconnection race)
let isShuttingDown = false;

// Track the current sync promise for graceful shutdown
let currentSyncPromise: Promise<void> | null = null;

// Channel name for sync notifications (must match sync-notifier.service.ts)
const SYNC_CHANNEL = "sync_trigger";

// Create a dedicated postgres client for LISTEN
let listenClient = createListenClient();

function createListenClient() {
  return postgres(config.DATABASE_URL, {
    max: 1, // Only need one connection for listening
    idle_timeout: 0, // Keep connection alive
    onclose: () => {
      if (isShuttingDown) return;
      console.error("[Sync Worker] LISTEN connection closed unexpectedly");
      console.log("[Sync Worker] Attempting to re-establish LISTEN...");
      listenClient = createListenClient();
      setTimeout(setupListen, 5000);
    },
  });
}

/**
 * Sync handler function
 * Called by the adaptive SyncScheduler on every tick.
 * After each run we let the scheduler re-evaluate the tier based on the
 * observed result.
 */
async function handleSync(): Promise<SyncResult | void> {
  if (isSyncing) {
    console.warn("[Sync Worker] Sync already in progress, skipping...");
    return;
  }

  isSyncing = true;
  const startTime = Date.now();

  let result: SyncResult | undefined;
  currentSyncPromise = runSync()
    .then((r) => {
      result = r;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(
        `[Sync Worker] Sync completed in ${duration}s: ` +
          `${r.eventsCreated} events created, ` +
          `${r.transactionsProcessed} transactions processed`,
      );

      if (r.errors.length > 0) {
        console.error(
          `[Sync Worker] Sync had ${r.errors.length} errors:`,
          r.errors,
        );
      }
    })
    .catch((error) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[Sync Worker] Sync failed after ${duration}s:`, error);
    })
    .finally(() => {
      isSyncing = false;
      currentSyncPromise = null;
    });

  await currentSyncPromise;

  // Post-sync: let the scheduler re-evaluate cadence based on observed state.
  try {
    await SyncScheduler.evaluateAndReschedule(result);
  } catch (err) {
    console.error("[Sync Worker] Scheduler evaluation failed:", err);
  }

  return result;
}

// Phase A7a + Polaris Track A: cleanup cron — runs every 2 minutes and prunes:
//   - `rate_limits`        rows older than 120s (RATE_LIMIT_WINDOW_MS = 60s)
//   - `verifications`      expired scan-pair entries past their expiresAt
//   - `auth_audit`         rows older than 90 days (forensic retention window)
//   - `magic_link_audit`   rows older than 30 days (token already expired in 15m)
//
// Each prune runs independently so a failure in one doesn't drop the others.
// The same Cron job ticks every 2 min; the audit prunes are cheap (indexed
// on created_at DESC) and idempotent.
const rateLimitCleanupJob = new Cron(
  "*/2 * * * *",
  { protect: true, timezone: "UTC" },
  async () => {
    // 1. Rate limits — frequent, narrow window.
    try {
      const result = await db
        .delete(rateLimits)
        .where(sql`updated_at < now() - interval '120 seconds'`);
      console.log(
        `[Sync Worker] rate_limits cleanup ok; rows removed: ${
          (result as unknown as { count?: number })?.count ?? "unknown"
        }`,
      );
    } catch (err) {
      console.error("[Sync Worker] rate_limits cleanup failed:", err);
    }

    // 2. Verifications — purge expired scan-pair rows + Better-Auth's own
    // verification entries past their TTL. The `expiresAt` column is set by
    // both flows; deleting on it is safe and self-correcting.
    try {
      const result = await db
        .delete(verifications)
        .where(sql`expires_at < now()`);
      const removed = (result as unknown as { count?: number })?.count;
      if (removed && removed > 0) {
        console.log(
          `[Sync Worker] verifications cleanup ok; rows removed: ${removed}`,
        );
      }
    } catch (err) {
      console.error("[Sync Worker] verifications cleanup failed:", err);
    }

    // 3. auth_audit — 90-day retention.
    try {
      const result = await db
        .delete(authAudit)
        .where(sql`created_at < now() - interval '90 days'`);
      const removed = (result as unknown as { count?: number })?.count;
      if (removed && removed > 0) {
        console.log(
          `[Sync Worker] auth_audit cleanup ok; rows removed: ${removed}`,
        );
      }
    } catch (err) {
      console.error("[Sync Worker] auth_audit cleanup failed:", err);
    }

    // 4. magic_link_audit — 30-day retention.
    try {
      const result = await db
        .delete(magicLinkAudit)
        .where(sql`requested_at < now() - interval '30 days'`);
      const removed = (result as unknown as { count?: number })?.count;
      if (removed && removed > 0) {
        console.log(
          `[Sync Worker] magic_link_audit cleanup ok; rows removed: ${removed}`,
        );
      }
    } catch (err) {
      console.error("[Sync Worker] magic_link_audit cleanup failed:", err);
    }

    // 5. idempotency_keys — 24-hour retention. Cached responses for
    //    state-changing endpoints; the helper handles its own errors.
    try {
      const removed = await pruneExpiredIdempotencyKeys();
      if (removed > 0) {
        console.log(
          `[Sync Worker] idempotency_keys cleanup ok; rows removed: ${removed}`,
        );
      }
    } catch (err) {
      console.error("[Sync Worker] idempotency_keys cleanup failed:", err);
    }
  },
);
console.log(
  `[Sync Worker] Rate-limit + audit cleanup cron scheduled; next run: ${
    rateLimitCleanupJob.nextRun()?.toISOString() ?? "unknown"
  }`,
);

// Phase 3c — device_logs retention. 7-day hot retention; pruned every
// 6 h in 10k-row batches so the DELETE doesn't grab a long lock. The
// 1 GB size alarm runs daily as a coarse early-warning before we
// outgrow Postgres and migrate to Loki.
const deviceLogsRetentionJob = new Cron(
  "0 */6 * * *",
  { protect: true, timezone: "UTC" },
  async () => {
    let totalRemoved = 0;
    // Loop in capped batches so we don't hold an exclusive lock on the
    // index for the duration of one giant DELETE.
    for (let batch = 0; batch < 100; batch++) {
      try {
        const result = await db.execute(sql`
          DELETE FROM device_logs
          WHERE (device_id, seq) IN (
            SELECT device_id, seq FROM device_logs
            WHERE observed_ts < now() - interval '7 days'
            LIMIT 10000
          )
        `);
        const removed =
          (result as unknown as { rowCount?: number; count?: number })
            ?.rowCount ??
            (result as unknown as { count?: number })?.count ??
            0;
        totalRemoved += removed;
        if (removed === 0) break;
      } catch (err) {
        console.error("[Sync Worker] device_logs prune failed:", err);
        break;
      }
    }
    if (totalRemoved > 0) {
      console.log(
        `[Sync Worker] device_logs retention prune ok; rows removed: ${totalRemoved}`,
      );
    }
  },
);
console.log(
  `[Sync Worker] device_logs retention cron scheduled; next run: ${
    deviceLogsRetentionJob.nextRun()?.toISOString() ?? "unknown"
  }`,
);

const deviceLogsSizeAlarmJob = new Cron(
  "0 6 * * *",
  { protect: true, timezone: "UTC" },
  async () => {
    try {
      const result = await db.execute<{ size_bytes: string }>(sql`
        SELECT pg_total_relation_size('device_logs')::text AS size_bytes
      `);
      const rows = (Array.isArray(result)
        ? result
        : (result as { rows?: { size_bytes: string }[] }).rows ?? []) as {
          size_bytes: string;
        }[];
      const sizeBytes = BigInt(rows[0]?.size_bytes ?? "0");
      const oneGiB = 1_073_741_824n;
      if (sizeBytes > oneGiB) {
        console.warn(
          `[Sync Worker] device_logs size alarm: ${sizeBytes} bytes > 1 GiB. ` +
            `Time to consider Loki/VictoriaLogs migration — see docs/logging/contract.md.`,
        );
      }
      // Reference deviceLogs so the import isn't pruned by the linter.
      void deviceLogs;
    } catch (err) {
      console.error("[Sync Worker] device_logs size alarm failed:", err);
    }
  },
);
console.log(
  `[Sync Worker] device_logs size-alarm cron scheduled; next run: ${
    deviceLogsSizeAlarmJob.nextRun()?.toISOString() ?? "unknown"
  }`,
);

// Reservation status resolver — every minute, poll any pending
// reservation whose `steve_reservation_id` is set. StEvE 3.12.0 returns
// 404 for the task endpoint; the resolver no-ops cleanly until StEvE is
// upgraded past 3.12.0 and starts returning task statuses. Once the
// OCPP StatusNotification stream is wired into recordChargerStatus
// with connector context, the side-channel `tryConfirmFromStatusNotification`
// will close the loop without waiting on this poll.
const reservationResolverJob = new Cron(
  "* * * * *",
  { protect: true, timezone: "UTC" },
  async () => {
    try {
      const result = await resolvePendingReservations();
      if (result.confirmed > 0 || result.conflicted > 0) {
        console.log(
          `[Sync Worker] reservation resolver: polled=${result.polled} ` +
            `confirmed=${result.confirmed} conflicted=${result.conflicted}`,
        );
      }
    } catch (err) {
      console.error("[Sync Worker] reservation resolver failed:", err);
    }
  },
);
console.log(
  `[Sync Worker] reservation resolver cron scheduled; next run: ${
    reservationResolverJob.nextRun()?.toISOString() ?? "unknown"
  }`,
);

// Start the adaptive scheduler (replaces the old fixed Cron).
await SyncScheduler.start(handleSync);
console.log("[Sync Worker] Adaptive scheduler started");
console.log(
  `[Sync Worker] Current tier: ${SyncScheduler.currentTier()}; ` +
    `next run: ${SyncScheduler.nextRunAt()?.toISOString() ?? "unknown"}`,
);

// Set up LISTEN for manual sync triggers with reconnection logic
async function setupListen() {
  try {
    await listenClient.listen(
      SYNC_CHANNEL,
      (payload) => {
        try {
          const data = JSON.parse(payload);
          console.log(
            `[Sync Worker] Received sync trigger notification from ${data.source}`,
          );
          // Bump tier to Active first (so cadence is 15m going forward),
          // then fire the handler which will evaluate cadence when done.
          SyncScheduler.onActivityDetected(`manual:${data.source ?? "unknown"}`)
            .catch((err) => {
              console.error(
                "[Sync Worker] Failed to record manual activity:",
                err,
              );
            })
            .finally(() => {
              handleSync().catch((error) => {
                console.error("[Sync Worker] Manual sync failed:", error);
              });
            });
        } catch (error) {
          console.error(
            "[Sync Worker] Failed to parse notification payload:",
            error,
          );
        }
      },
      () => {
        console.log(
          `[Sync Worker] LISTEN connection established on channel: ${SYNC_CHANNEL}`,
        );
      },
    );
    console.log(`[Sync Worker] LISTEN established on ${SYNC_CHANNEL}`);
  } catch (error) {
    console.error("[Sync Worker] LISTEN failed, retrying in 5s:", error);
    setTimeout(setupListen, 5000);
  }
}

console.log(`[Sync Worker] Setting up LISTEN on channel: ${SYNC_CHANNEL}`);
await setupListen();

// Run sync immediately on startup (optional, but useful for testing)
if (config.SYNC_ON_STARTUP === "true") {
  console.log("[Sync Worker] Running initial sync on startup...");
  handleSync().catch((error) => {
    console.error("[Sync Worker] Initial sync failed:", error);
  });
}

// Graceful shutdown handler
const shutdown = async () => {
  isShuttingDown = true;
  console.log("[Sync Worker] Shutting down gracefully...");
  SyncScheduler.stop();
  rateLimitCleanupJob.stop();
  reservationResolverJob.stop();
  deviceLogsRetentionJob.stop();
  deviceLogsSizeAlarmJob.stop();
  console.log("[Sync Worker] Scheduler stopped");

  if (currentSyncPromise) {
    console.log("[Sync Worker] Waiting for in-flight sync to complete...");
    await currentSyncPromise;
    console.log("[Sync Worker] In-flight sync finished");
  }

  await listenClient.end();
  console.log("[Sync Worker] LISTEN connection closed");
  Deno.exit(0);
};

// Handle termination signals
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Keep the process alive
console.log("[Sync Worker] Worker is running. Press Ctrl+C to stop.");

// Prevent the process from exiting
await new Promise(() => {});
