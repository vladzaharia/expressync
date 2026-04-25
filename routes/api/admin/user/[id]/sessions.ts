/**
 * DELETE /api/admin/user/:id/sessions
 *
 * Admin-only forced session revocation. Deletes every row in `sessions`
 * for the target user, effectively logging them out of every device. The
 * middleware has already enforced admin-on-admin-host and a same-origin
 * Origin check, so we only need to:
 *
 *   1. Reject self-revocation (admins should not be able to lock
 *      themselves out via this endpoint — there are dedicated logout
 *      flows for that).
 *   2. Delete every sessions row for `params.id`.
 *   3. Audit the action via `logAuthEvent("session.revoked", ...)`.
 *
 * Response: { revoked: number } — count of rows actually deleted (0 is
 * fine; the user simply had no active sessions).
 */
import { eq } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { sessions } from "../../../../../src/db/schema.ts";
import { logAuthEvent } from "../../../../../src/lib/audit.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminSessionsRevoke");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async DELETE(ctx) {
    const targetId = ctx.params.id;
    const adminId = ctx.state.user?.id;
    if (!adminId) {
      // Middleware should have caught this; defense in depth.
      return jsonResponse(401, { error: "unauthorized" });
    }
    if (targetId === adminId) {
      // Self-protection: revoking our own sessions via this admin endpoint
      // would log us out mid-request and is almost certainly a footgun
      // rather than an intent.
      return jsonResponse(400, { error: "cannot_revoke_self" });
    }
    let deleted: { id: string }[];
    try {
      deleted = await db
        .delete(sessions)
        .where(eq(sessions.userId, targetId))
        .returning({ id: sessions.id });
    } catch (err) {
      log.error("Failed to delete sessions", {
        error: err instanceof Error ? err.message : String(err),
        targetId,
      });
      return jsonResponse(500, { error: "internal" });
    }

    void logAuthEvent("session.revoked", {
      userId: adminId,
      ip: ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        null,
      ua: ctx.req.headers.get("user-agent") ?? null,
      route: `/api/admin/user/${targetId}/sessions`,
      metadata: {
        targetUserId: targetId,
        revoked: deleted.length,
      },
    });

    return jsonResponse(200, { revoked: deleted.length });
  },
});
