import { define } from "../../utils.ts";
import { runSync } from "../../src/services/sync.service.ts";

/**
 * POST /api/sync
 *
 * Manually trigger a sync run.
 * Useful for testing and debugging.
 *
 * Returns the sync result with statistics.
 */
export const handler = define.handlers({
  async POST(_req) {
    try {
      console.log("[API] Manual sync triggered");
      const result = await runSync();

      return new Response(
        JSON.stringify({
          success: true,
          data: result,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("[API] Sync failed:", error);
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

