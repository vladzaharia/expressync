/**
 * POST /api/customer/onboarded
 *
 * Idempotently mark the authenticated customer as onboarded:
 *   `UPDATE users SET onboarded_at = COALESCE(onboarded_at, now())`
 *
 * The OnboardingTour calls this on Skip/Got-It. Re-calling is a no-op (the
 * COALESCE preserves the original timestamp). Returns the resulting
 * `onboardedAt` so the UI can confirm.
 *
 * Read-only impersonation: admins acting-as get 403.
 */

import { define } from "../../../utils.ts";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { logCustomerAction } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerOnboardedAPI");

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
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only while impersonating; use admin tools to mutate.",
      });
    }

    try {
      const userId = ctx.state.user.id;
      // COALESCE preserves any existing timestamp, making this idempotent.
      const [updated] = await db
        .update(schema.users)
        .set({
          onboardedAt: sql`COALESCE(${schema.users.onboardedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId))
        .returning({ onboardedAt: schema.users.onboardedAt });

      if (!updated) {
        return jsonResponse(404, { error: "User not found" });
      }

      await logCustomerAction({
        userId,
        action: "onboarded",
        route: new URL(ctx.req.url).pathname,
      });

      return jsonResponse(200, {
        onboardedAt: updated.onboardedAt
          ? updated.onboardedAt.toISOString()
          : null,
      });
    } catch (err) {
      log.error("Failed to mark customer onboarded", err as Error);
      return jsonResponse(500, { error: "Failed to mark onboarded" });
    }
  },
});
