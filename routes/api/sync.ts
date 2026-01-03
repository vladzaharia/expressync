import { define } from "../../utils.ts";
import { triggerSync } from "../../src/services/sync-notifier.service.ts";

/**
 * POST /api/sync
 *
 * Manually trigger a sync run by sending a notification to the sync worker.
 * This uses PostgreSQL LISTEN/NOTIFY to signal the sync worker.
 *
 * The sync worker will receive the notification and run the sync asynchronously.
 * This endpoint returns immediately after sending the notification.
 */
export const handler = define.handlers({
  async POST(_req) {
    try {
      console.log("[API] Manual sync triggered via notification");
      await triggerSync("api");

      return new Response(
        JSON.stringify({
          success: true,
          message: "Sync trigger notification sent to worker",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("[API] Failed to trigger sync:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: (error as Error).message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
});

