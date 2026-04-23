/**
 * GET /api/customer/invoices
 *
 * Customer-scoped paginated invoice list. Filters Lago by the authenticated
 * customer's `external_customer_id`. Empty scope (no Lago link) returns an
 * empty page rather than 4xx — admins viewing the customer surface without
 * impersonation see "no invoices" instead of an error.
 *
 * Query params:
 *   page          — Lago page (default 1)
 *   per_page      — Lago page size (default 20, max 100)
 *   status        — Lago status filter (comma-separated allowed)
 *   payment_status — payment_status filter (comma-separated allowed)
 *   from          — issuing_date_from YYYY-MM-DD
 *   to            — issuing_date_to YYYY-MM-DD
 */

import { define } from "../../../../utils.ts";
import { lagoClient } from "../../../../src/lib/lago-client.ts";
import { resolveCustomerScope } from "../../../../src/lib/scoping.ts";
import { toInvoiceListDTO } from "../../../../src/lib/invoice-ui.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerInvoicesAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function splitCsv(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const url = new URL(ctx.req.url);
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const perPage = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("per_page") ?? "20", 10) || 20),
    );
    if (!Number.isFinite(page) || page < 1) {
      return jsonResponse(400, { error: "Invalid page parameter" });
    }

    try {
      const scope = await resolveCustomerScope(ctx);
      // No Lago link → empty page (no error). Mirrors the sessions endpoint.
      if (!scope.lagoCustomerExternalId) {
        return jsonResponse(200, {
          invoices: [],
          totalUnpaidCents: 0,
          meta: { current_page: page, total_pages: 0, total_count: 0 },
        });
      }

      const status = splitCsv(url.searchParams.get("status"));
      const paymentStatus = splitCsv(url.searchParams.get("payment_status"));
      const from = url.searchParams.get("from") ?? undefined;
      const to = url.searchParams.get("to") ?? undefined;

      const { invoices, meta } = await lagoClient.listInvoices({
        externalCustomerId: scope.lagoCustomerExternalId,
        page,
        perPage,
        status,
        paymentStatus,
        issuingDateFrom: from,
        issuingDateTo: to,
      });

      let totalUnpaidCents = 0;
      const items = invoices.map((inv) => {
        if (
          inv.status === "finalized" &&
          inv.payment_status !== "succeeded"
        ) {
          totalUnpaidCents += inv.total_amount_cents;
        }
        return toInvoiceListDTO(inv);
      });

      return jsonResponse(200, {
        invoices: items,
        totalUnpaidCents,
        meta,
      });
    } catch (error) {
      log.error("Failed to list customer invoices", error as Error);
      return jsonResponse(502, { error: "Failed to list invoices" });
    }
  },
});
