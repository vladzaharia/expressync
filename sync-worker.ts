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
import { config, validateSyncWorkerConfig } from "./src/lib/config.ts";
import { runSync, type SyncResult } from "./src/services/sync.service.ts";
import { SyncScheduler } from "./src/services/sync-scheduler.ts";
import { ensureLagoMetricSafety } from "./src/services/lago-safety.service.ts";

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
