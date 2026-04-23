/**
 * POST /api/customer/impersonation/start
 *
 * Admin-only. Body: { customerUserId }.
 *
 * Validates the target user exists and has `role='customer'`. Logs the
 * attempt to `impersonation_audit` and `auth_audit`. Returns
 * `{ redirectTo: "/?as=<id>" }` for the caller to navigate to.
 *
 * The actual impersonation marker lives in the URL (`?as=<id>`) — middleware
 * picks it up and sets `ctx.state.actingAs`. We don't issue a swap session
 * cookie; the admin's primary session is preserved and scoping helpers read
 * `actingAs ?? user.id`. See `routes/_middleware.ts` step 9 for the receive
 * end of this handshake.
 *
 * Lives under `/api/customer/*` because the redirect target IS the customer
 * surface — keeping the start endpoint co-located makes the surface
 * consistent for the front-end.
 */

import { define } from "../../../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import {
  logImpersonationStart,
  logPasswordLoginFailed,
} from "../../../../src/lib/audit.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("ImpersonationStartAPI");

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
      // Use the existing privilege_violation tag so the forensic pipeline
      // sees the failed escalation attempt.
      await logPasswordLoginFailed({
        userId: ctx.state.user.id,
        route: new URL(ctx.req.url).pathname,
        metadata: { reason: "non_admin_attempted_impersonation" },
      });
      return jsonResponse(403, { error: "Forbidden" });
    }
    if (ctx.state.actingAs) {
      return jsonResponse(409, {
        error: "Already impersonating; end the current session first.",
      });
    }

    let body: { customerUserId?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const customerUserId = body.customerUserId;
    if (typeof customerUserId !== "string" || customerUserId.length === 0) {
      return jsonResponse(400, {
        error: "customerUserId is required and must be a string",
      });
    }
    if (customerUserId === ctx.state.user.id) {
      return jsonResponse(400, { error: "Cannot impersonate yourself" });
    }

    try {
      const [target] = await db
        .select({ id: schema.users.id, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, customerUserId))
        .limit(1);

      if (!target) {
        // Don't differentiate between "no such user" and "wrong role" so
        // admins can't enumerate.
        return jsonResponse(404, { error: "Customer not found" });
      }
      if (target.role !== "customer") {
        return jsonResponse(404, { error: "Customer not found" });
      }

      // Audit + first-row stamp. Subsequent per-route entries are written by
      // the middleware's rate-limited insert path.
      try {
        await db.insert(schema.impersonationAudit).values({
          adminUserId: ctx.state.user.id,
          customerUserId: target.id,
          route: new URL(ctx.req.url).pathname,
          method: "POST",
        });
      } catch (auditErr) {
        log.warn("impersonation_audit insert failed (non-fatal)", {
          error: auditErr instanceof Error
            ? auditErr.message
            : String(auditErr),
        });
      }
      await logImpersonationStart({
        userId: ctx.state.user.id,
        route: new URL(ctx.req.url).pathname,
        metadata: { customerUserId: target.id },
      });

      return jsonResponse(200, {
        redirectTo: `/?as=${encodeURIComponent(target.id)}`,
        customerUserId: target.id,
      });
    } catch (err) {
      log.error("Failed to start impersonation", err as Error);
      return jsonResponse(500, { error: "Failed to start impersonation" });
    }
  },
});
