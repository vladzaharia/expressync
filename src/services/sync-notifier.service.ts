/**
 * Sync Notifier Service
 *
 * Provides a mechanism to trigger the sync worker using PostgreSQL LISTEN/NOTIFY.
 * This allows the web app to signal the sync worker to run a sync immediately.
 */

import postgres from "postgres";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";

// Channel name for sync notifications
const SYNC_CHANNEL = "sync_trigger";

// Create a dedicated postgres client for notifications
// This is separate from the Drizzle-wrapped connection
let notifyClient: ReturnType<typeof postgres> | null = null;

/**
 * Initialize the notify client
 */
function getNotifyClient() {
  if (!notifyClient) {
    notifyClient = postgres(config.DATABASE_URL, {
      max: 1, // Only need one connection for notifications
      idle_timeout: 0, // Keep connection alive
    });
  }
  return notifyClient;
}

/**
 * Trigger a sync run by sending a NOTIFY to the sync worker
 *
 * @param source - Optional source identifier (e.g., "manual", "api", "webhook")
 * @returns Promise that resolves when the notification is sent
 */
export async function triggerSync(source = "manual"): Promise<void> {
  const sql = getNotifyClient();

  const payload = JSON.stringify({
    source,
    timestamp: new Date().toISOString(),
  });

  logger.info("SyncNotifier", "Sending sync trigger notification", {
    source,
    channel: SYNC_CHANNEL,
  });

  try {
    await sql.notify(SYNC_CHANNEL, payload);
    logger.debug("SyncNotifier", "Sync trigger notification sent successfully");
  } catch (error) {
    logger.error("SyncNotifier", "Failed to send sync trigger notification", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Close the notify client connection
 */
export async function closeNotifier(): Promise<void> {
  if (notifyClient) {
    await notifyClient.end();
    notifyClient = null;
  }
}

