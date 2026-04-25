import { define } from "@/utils.ts";
import {
  getCircuitBreakerState,
  resetCircuitBreaker,
} from "@/src/services/lago-webhook-handler.service.ts";
import { logger } from "@/src/lib/utils/logger.ts";

const log = logger.child("AdminWebhookCircuitBreaker");

/**
 * GET  /api/admin/webhook-events/circuit-breaker
 *   → returns the current snapshot (admin-only):
 *       { open, consecutiveFailures, threshold, disabledUntilMs, cooldownMs }
 *
 * POST /api/admin/webhook-events/circuit-breaker
 *   → admin-triggered reset. Clears the failure counter + cooldown flag.
 *     Response mirrors the new snapshot. (We bundle reset under the same
 *     path as GET so the client only needs one URL per banner.)
 */
export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    const snapshot = getCircuitBreakerState();
    return new Response(
      JSON.stringify(snapshot),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },

  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    await resetCircuitBreaker();
    log.info("Circuit breaker reset via admin UI", {
      userId: ctx.state.user?.id,
      email: ctx.state.user?.email,
    });
    const snapshot = getCircuitBreakerState();
    return new Response(
      JSON.stringify({ reset: true, ...snapshot }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
});
