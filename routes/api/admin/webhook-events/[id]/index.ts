import { define } from "@/utils.ts";
import { db } from "@/src/db/index.ts";
import { lagoWebhookEvents } from "@/src/db/schema.ts";
import { eq } from "drizzle-orm";

/**
 * GET /api/admin/webhook-events/[id]
 *
 * Admin-only. Returns the full row including `rawPayload` so the
 * admin UI can render the payload viewer without re-requesting it for every
 * row in the table.
 */
export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const id = parseInt(ctx.params.id ?? "", 10);
    if (!id || isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "Invalid event id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const [row] = await db
        .select()
        .from(lagoWebhookEvents)
        .where(eq(lagoWebhookEvents.id, id))
        .limit(1);

      if (!row) {
        return new Response(
          JSON.stringify({ error: `Webhook event ${id} not found` }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify(row),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({
          error: "Failed to load webhook event",
          details: message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
