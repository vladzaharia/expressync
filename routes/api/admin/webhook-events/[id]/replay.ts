import { define } from "@/utils.ts";
import { replay } from "@/src/services/lago-webhook-handler.service.ts";

/**
 * POST /api/admin/webhook-events/[id]/replay
 *
 * Admin-only. Replays a previously-persisted Lago webhook event:
 *   1. clones the source row into a new `lago_webhook_events` row tagged with
 *      `replayed_from_id = id`, `replayed_at = now()`, `replayed_by_user_id`
 *   2. runs the existing dispatch pipeline against the clone
 *
 * The handler never throws — the service returns `{ success, newEventId,
 * error? }` and we serialize that directly so the bulk caller can aggregate.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const rawId = ctx.params.id;
    const eventId = parseInt(rawId ?? "", 10);
    if (!eventId || isNaN(eventId)) {
      return new Response(
        JSON.stringify({ error: "Invalid event id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const userId = ctx.state.user?.id;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await replay(eventId, userId);
    const status = result.success ? 200 : 502;

    return new Response(
      JSON.stringify(result),
      { status, headers: { "Content-Type": "application/json" } },
    );
  },
});
