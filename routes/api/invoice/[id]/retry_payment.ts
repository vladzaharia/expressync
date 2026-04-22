import { define } from "../../../../utils.ts";
import { lagoClient } from "../../../../src/lib/lago-client.ts";

/**
 * POST /api/invoice/[id]/retry_payment
 *
 * Admin-only. Asks Lago to retry the customer's payment.
 * Lago replies 200 with an empty body; the UI flips to `pending` and polls
 * `/refresh` until the webhook fires.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const id = ctx.params.id;
    if (!id) return json({ error: "Missing invoice id" }, 400);

    try {
      await lagoClient.retryPayment(id);
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to retry invoice payment", { id, error: message });
      return json(
        { error: `Failed to retry invoice payment: ${message}` },
        502,
      );
    }
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
