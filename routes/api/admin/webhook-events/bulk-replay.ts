import { define } from "@/utils.ts";
import { replay } from "@/src/services/lago-webhook-handler.service.ts";
import { z } from "zod";

const BulkReplayBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

/**
 * POST /api/admin/webhook-events/bulk-replay
 *
 * Body: { ids: number[] } (1–100)
 *
 * Runs replays sequentially (not in parallel) so log lines stay interpretable
 * and the circuit breaker has a chance to react between attempts. Returns a
 * per-id breakdown so the client can show a "{n} replayed, {m} failed" toast.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const userId = ctx.state.user?.id;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: z.infer<typeof BulkReplayBodySchema>;
    try {
      const raw = await ctx.req.json();
      body = BulkReplayBodySchema.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({
          error: "Invalid body",
          details: message,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const results: Array<
      { id: number; success: boolean; newEventId: number; error?: string }
    > = [];

    for (const id of body.ids) {
      const result = await replay(id, userId);
      results.push({ id, ...result });
    }

    const replayed = results.filter((r) => r.success).length;
    const failed = results.length - replayed;

    return new Response(
      JSON.stringify({
        total: results.length,
        replayed,
        failed,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
});
