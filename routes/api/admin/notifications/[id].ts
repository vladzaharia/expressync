/**
 * PATCH /api/notifications/[id]
 * DELETE /api/notifications/[id]
 *
 * PATCH accepts `{ action: "mark_read" | "dismiss" }`. Admin-only (gated by
 * `routes/_middleware.ts`). Both ops scope to the caller's user id so a
 * broadcast row (adminUserId NULL) is read/dismissed for everyone, while a
 * targeted row is only touched by the intended recipient.
 *
 * Returns `{ ok: true, updated: boolean }` so the client can distinguish "row
 * didn't exist / already in that state" from a hard error.
 */

import { define } from "../../../../utils.ts";
import {
  dismiss,
  markRead,
} from "../../../../src/services/notification.service.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("NotificationsAPI");

export const handler = define.handlers({
  async PATCH(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const idParam = ctx.params.id;
    const id = parseInt(idParam, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid notification id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: { action?: string } = {};
    try {
      body = await ctx.req.json();
    } catch {
      // Accept empty bodies — default action is mark_read.
    }

    const action = body.action ?? "mark_read";

    try {
      let updated = false;
      if (action === "mark_read") {
        updated = await markRead(id, user.id);
      } else if (action === "dismiss") {
        updated = await dismiss(id, user.id);
      } else {
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ ok: true, updated }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      log.error("Failed to update notification", err as Error);
      return new Response(
        JSON.stringify({ error: "Failed to update notification" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  async DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const idParam = ctx.params.id;
    const id = parseInt(idParam, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid notification id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const updated = await dismiss(id, user.id);
      return new Response(JSON.stringify({ ok: true, updated }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      log.error("Failed to dismiss notification", err as Error);
      return new Response(
        JSON.stringify({ error: "Failed to dismiss notification" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
