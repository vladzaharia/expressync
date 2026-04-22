import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";

/**
 * POST /api/invoice/[id]/pdf
 *
 * Admin-only. Triggers Lago's async PDF generation.
 * - When Lago returns an invoice with a populated `file_url`, respond 200 +
 *   `{ fileUrl }` so the client can open it in a new tab.
 * - When the URL is not yet ready, respond 202 `{ status: 'pending' }` and
 *   the client polls `/refresh` every 2 s up to 10 s.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const id = ctx.params.id;
    if (!id) return json({ error: "Missing invoice id" }, 400);

    try {
      const result = await lagoClient.downloadInvoicePdf(id);

      if ("invoice" in result && result.invoice.file_url) {
        return json({ fileUrl: result.invoice.file_url }, 200);
      }

      // Async — Lago will populate `file_url` shortly.
      return json({ status: "pending" }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to request invoice PDF", { id, error: message });
      return json({ error: `Failed to request PDF: ${message}` }, 502);
    }
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
