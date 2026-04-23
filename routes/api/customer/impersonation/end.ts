/**
 * POST /api/customer/impersonation/end
 *
 * Admin-only. Logs the end of an impersonation session and returns
 * `{ redirectTo: "/admin" }` for the caller to navigate to.
 *
 * Practically the impersonation marker is just `?as=` in the URL — clearing
 * the marker is a client-side URL operation. This endpoint exists so:
 *   - The end-of-session is auditable (paired with `impersonation.start`).
 *   - The front-end has a stable POST it can call from the
 *     `ImpersonationBanner` Exit button.
 */

import { define } from "../../../../utils.ts";
import { logImpersonationEnd } from "../../../../src/lib/audit.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("ImpersonationEndAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "Forbidden" });
    }

    try {
      const route = new URL(ctx.req.url).pathname;
      await logImpersonationEnd({
        userId: ctx.state.user.id,
        route,
        metadata: {
          customerUserId: ctx.state.actingAs ?? null,
        },
      });
    } catch (err) {
      // Audit failure is non-fatal. We still return success so the UI
      // navigates back to the admin surface.
      log.warn("impersonation.end audit failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return jsonResponse(200, { redirectTo: "/admin" });
  },
});
