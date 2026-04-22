import { define } from "../../../utils.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import {
  deriveInvoiceUiStatus,
  extractInvoiceCustomer,
  extractInvoiceSubscription,
  type InvoiceUiStatus,
} from "../../../src/lib/invoice-ui.ts";

/**
 * GET /api/invoice/export.csv
 *
 * Streams a CSV of all invoices matching the same filters as the list page.
 * Accepts repeated `status=` query params plus `from`, `to`, `search`,
 * `customerId`.
 *
 * Paginates through Lago's `/invoices` 100 rows at a time; streams rows to
 * the client as each page arrives so large exports don't buffer in memory.
 */
export const handler = define.handlers({
  GET(ctx) {
    if (!ctx.state.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const url = new URL(ctx.req.url);
    const statusFilter = url.searchParams.getAll("status") as InvoiceUiStatus[];
    const search = url.searchParams.get("search") ?? undefined;
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const customerId = url.searchParams.get("customerId") ?? undefined;

    // UI statuses don't map 1:1 to Lago filters; we send what we can and
    // post-filter the rest client-side.
    const lagoStatus: string[] = [];
    const lagoPaymentStatus: string[] = [];
    for (const s of statusFilter) {
      switch (s) {
        case "draft":
        case "finalized":
        case "voided":
        case "failed":
        case "pending":
          if (!lagoStatus.includes(s)) lagoStatus.push(s);
          break;
        case "paid":
          if (!lagoStatus.includes("finalized")) lagoStatus.push("finalized");
          if (!lagoPaymentStatus.includes("succeeded")) {
            lagoPaymentStatus.push("succeeded");
          }
          break;
        case "overdue":
          if (!lagoStatus.includes("finalized")) lagoStatus.push("finalized");
          break;
      }
    }

    const header = [
      "id",
      "number",
      "status",
      "payment_status",
      "ui_status",
      "currency",
      "total_cents",
      "issuing_date",
      "payment_due_date",
      "payment_overdue",
      "external_customer_id",
      "customer_name",
      "external_subscription_id",
      "invoice_type",
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(header.join(",") + "\n"));

        try {
          let page = 1;
          const perPage = 100;
          while (true) {
            const { invoices, meta } = await lagoClient.listInvoices({
              page,
              perPage,
              status: lagoStatus.length > 0 ? lagoStatus : undefined,
              paymentStatus: lagoPaymentStatus.length > 0
                ? lagoPaymentStatus
                : undefined,
              paymentOverdue: statusFilter.includes("overdue")
                ? true
                : undefined,
              issuingDateFrom: from,
              issuingDateTo: to,
              searchTerm: search,
              externalCustomerId: customerId,
            });

            for (const inv of invoices) {
              const uiStatus = deriveInvoiceUiStatus({
                status: inv.status,
                payment_status: inv.payment_status,
                payment_overdue: inv.payment_overdue,
              });
              if (statusFilter.length > 0 && !statusFilter.includes(uiStatus)) {
                continue;
              }
              const { externalCustomerId, customerName } =
                extractInvoiceCustomer(inv);
              const extSub = extractInvoiceSubscription(inv);
              const row = [
                inv.lago_id,
                inv.number,
                inv.status,
                inv.payment_status,
                uiStatus,
                inv.currency,
                String(inv.total_amount_cents),
                inv.issuing_date,
                inv.payment_due_date ?? "",
                inv.payment_overdue ? "true" : "false",
                externalCustomerId ?? "",
                customerName ?? "",
                extSub ?? "",
                inv.invoice_type ?? "",
              ].map(csvEscape).join(",");
              controller.enqueue(encoder.encode(row + "\n"));
            }

            const totalPages = meta?.total_pages ?? 1;
            if (page >= totalPages || invoices.length === 0) break;
            page += 1;
          }

          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Invoice CSV export failed", { error: message });
          controller.enqueue(
            encoder.encode(`# error: ${message.replace(/[\r\n]+/g, " ")}\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoices-${
          new Date().toISOString().slice(0, 10)
        }.csv"`,
      },
    });
  },
});

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
