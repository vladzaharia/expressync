/**
 * DELETE /api/admin/user/:id/sessions/:sessionId
 *
 * Admin-only per-session revocation. Sister to the bulk revoke at
 * `…/sessions` — used by the user detail page's per-row "Revoke"
 * button so an admin can drop a specific suspect session without
 * logging the user out of all their other devices.
 *
 * Returns 204 on success, 404 when the session doesn't exist or
 * doesn't belong to that user (we treat the "wrong user" case as a
 * soft 404 rather than a 403 to avoid leaking session existence).
 */

import { and, eq } from "drizzle-orm";
import { define } from "../../../../../../utils.ts";
import { db } from "../../../../../../src/db/index.ts";
import { sessions } from "../../../../../../src/db/schema.ts";
import { logAuthEvent } from "../../../../../../src/lib/audit.ts";
import { logger } from "../../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminSessionRevoke");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async DELETE(ctx) {
    const targetUserId = ctx.params.id;
    const targetSessionId = ctx.params.sessionId;
    const adminId = ctx.state.user?.id;
    if (!adminId) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    if (!targetUserId || !targetSessionId) {
      return jsonResponse(400, { error: "invalid_params" });
    }

    let deleted: { id: string }[];
    try {
      deleted = await db
        .delete(sessions)
        .where(
          and(
            eq(sessions.id, targetSessionId),
            eq(sessions.userId, targetUserId),
          ),
        )
        .returning({ id: sessions.id });
    } catch (err) {
      log.error("Failed to delete session", {
        error: err instanceof Error ? err.message : String(err),
        targetUserId,
        targetSessionId,
      });
      return jsonResponse(500, { error: "internal" });
    }

    if (deleted.length === 0) {
      return jsonResponse(404, { error: "not_found" });
    }

    void logAuthEvent("session.revoked", {
      userId: adminId,
      ip: ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        null,
      ua: ctx.req.headers.get("user-agent") ?? null,
      route: `/api/admin/user/${targetUserId}/sessions/${targetSessionId}`,
      metadata: {
        targetUserId,
        targetSessionId,
        revoked: deleted.length,
      },
    });

    return new Response(null, { status: 204 });
  },
});
