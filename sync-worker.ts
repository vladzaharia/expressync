#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * OCPP Billing Sync Worker
 *
 * This is a dedicated service that runs the sync process on a schedule.
 * It uses Croner for reliable, production-ready cron scheduling.
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

import { Cron } from "croner";
import postgres from "postgres";
import { config, validateSyncWorkerConfig } from "./src/lib/config.ts";
import { runSync } from "./src/services/sync.service.ts";

// Validate configuration on startup
console.log("[Sync Worker] Starting OCPP Billing Sync Worker...");
console.log(`[Sync Worker] Schedule: ${config.SYNC_CRON_SCHEDULE}`);

try {
  validateSyncWorkerConfig();
  console.log("[Sync Worker] Configuration validated successfully");
} catch (error) {
  console.error("[Sync Worker] Configuration validation failed:", error);
  Deno.exit(1);
}

// Track if a sync is currently running (for additional safety)
let isSyncing = false;

// Channel name for sync notifications (must match sync-notifier.service.ts)
const SYNC_CHANNEL = "sync_trigger";

// Create a dedicated postgres client for LISTEN
const listenClient = postgres(config.DATABASE_URL, {
  max: 1, // Only need one connection for listening
  idle_timeout: 0, // Keep connection alive
});

/**
 * Sync handler function
 * This is called by Croner on the schedule
 */
async function handleSync() {
  // Extra safety check (Croner already prevents overlaps, but this is belt-and-suspenders)
  if (isSyncing) {
    console.warn("[Sync Worker] Sync already in progress, skipping...");
    return;
  }

  isSyncing = true;
  const startTime = Date.now();

  try {
    console.log("[Sync Worker] Starting scheduled sync...");
    const result = await runSync();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(
      `[Sync Worker] Sync completed in ${duration}s: ` +
        `${result.eventsCreated} events created, ` +
        `${result.transactionsProcessed} transactions processed`,
    );

    if (result.errors.length > 0) {
      console.error(
        `[Sync Worker] Sync had ${result.errors.length} errors:`,
        result.errors,
      );
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[Sync Worker] Sync failed after ${duration}s:`, error);
  } finally {
    isSyncing = false;
  }
}

// Create the cron job
// Croner automatically prevents overlapping executions
const job = new Cron(
  config.SYNC_CRON_SCHEDULE,
  {
    // Prevent overlapping executions (Croner feature)
    protect: true,
    // Use UTC timezone for consistency
    timezone: "UTC",
  },
  handleSync,
);

console.log("[Sync Worker] Cron job scheduled successfully");
console.log(`[Sync Worker] Next run: ${job.nextRun()?.toISOString()}`);

// Set up LISTEN for manual sync triggers
console.log(`[Sync Worker] Setting up LISTEN on channel: ${SYNC_CHANNEL}`);
await listenClient.listen(
  SYNC_CHANNEL,
  (payload) => {
    try {
      const data = JSON.parse(payload);
      console.log(
        `[Sync Worker] Received sync trigger notification from ${data.source}`,
      );
      handleSync().catch((error) => {
        console.error("[Sync Worker] Manual sync failed:", error);
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

// Run sync immediately on startup (optional, but useful for testing)
if (config.SYNC_ON_STARTUP === "true") {
  console.log("[Sync Worker] Running initial sync on startup...");
  handleSync().catch((error) => {
    console.error("[Sync Worker] Initial sync failed:", error);
  });
}

// Graceful shutdown handler
const shutdown = async () => {
  console.log("[Sync Worker] Shutting down gracefully...");
  job.stop();
  console.log("[Sync Worker] Cron job stopped");
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
