import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { config } from "../../src/lib/config.ts";
import { BackAction } from "../../components/shared/BackAction.tsx";
import InvoiceDetail from "../../islands/invoices/InvoiceDetail.tsx";
import {
  deriveInvoiceUiStatus,
  extractInvoiceCustomer,
  extractInvoiceSubscription,
  type InvoiceUiStatus,
} from "../../src/lib/invoice-ui.ts";

interface InvoiceDetailState {
  id: string;
  number: string;
  status: "draft" | "finalized" | "voided" | "failed" | "pending";
  paymentStatus: "pending" | "succeeded" | "failed";
  paymentOverdue: boolean;
  uiStatus: InvoiceUiStatus;
  currency: string;
  totalCents: number;
  feesCents: number;
  taxesCents: number;
  issuingDateIso: string;
  paymentDueDateIso: string | null;
  fileUrl: string | null;
  externalCustomerId: string | null;
  customerName: string | null;
  externalSubscriptionId: string | null;
}

interface LoaderData {
  invoice: InvoiceDetailState | null;
  lagoDashboardUrl: string;
  customerLagoId: string | null;
  lagoInvoiceUrl: string | null;
  errorMessage: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const id = ctx.params.id;
    if (!id) {
      return {
        data: {
          invoice: null,
          lagoDashboardUrl: config.LAGO_DASHBOARD_URL,
          customerLagoId: null,
          lagoInvoiceUrl: null,
          errorMessage: "Missing invoice id",
        } satisfies LoaderData,
      };
    }

    try {
      const { invoice } = await lagoClient.getInvoice(id);
      const { externalCustomerId, customerName } = extractInvoiceCustomer(
        invoice,
      );

      // Best-effort: fetch the customer so we can build a Lago dashboard URL.
      let customerLagoId: string | null = null;
      if (externalCustomerId) {
        try {
          const { customer } = await lagoClient.getCustomer(externalCustomerId);
          customerLagoId = customer.lago_id;
        } catch (err) {
          console.warn("Failed to fetch customer for invoice detail", {
            externalCustomerId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const lagoInvoiceUrl = config.LAGO_DASHBOARD_URL
        ? `${config.LAGO_DASHBOARD_URL}/invoices/${
          encodeURIComponent(invoice.lago_id)
        }/overview`
        : null;

      const detail: InvoiceDetailState = {
        id: invoice.lago_id,
        number: invoice.number,
        status: invoice.status as InvoiceDetailState["status"],
        paymentStatus: invoice
          .payment_status as InvoiceDetailState["paymentStatus"],
        paymentOverdue: Boolean(invoice.payment_overdue),
        uiStatus: deriveInvoiceUiStatus({
          status: invoice.status,
          payment_status: invoice.payment_status,
          payment_overdue: invoice.payment_overdue,
        }),
        currency: invoice.currency,
        totalCents: invoice.total_amount_cents,
        feesCents: invoice.fees_amount_cents ?? 0,
        taxesCents: invoice.taxes_amount_cents,
        issuingDateIso: invoice.issuing_date,
        paymentDueDateIso: invoice.payment_due_date ?? null,
        fileUrl: invoice.file_url ?? null,
        externalCustomerId,
        customerName,
        externalSubscriptionId: extractInvoiceSubscription(invoice),
      };

      return {
        data: {
          invoice: detail,
          lagoDashboardUrl: config.LAGO_DASHBOARD_URL,
          customerLagoId,
          lagoInvoiceUrl,
          errorMessage: null,
        } satisfies LoaderData,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to load invoice", { id, error: message });
      return {
        data: {
          invoice: null,
          lagoDashboardUrl: config.LAGO_DASHBOARD_URL,
          customerLagoId: null,
          lagoInvoiceUrl: null,
          errorMessage: message,
        } satisfies LoaderData,
      };
    }
  },
});

export default define.page<typeof handler>(function InvoiceDetailPage({
  data,
  url,
  state,
}) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      accentColor="teal"
      actions={<BackAction href="/invoices" />}
    >
      {data.invoice
        ? (
          <PageCard
            title={`Invoice ${data.invoice.number}`}
            description={data.invoice.externalSubscriptionId
              ? `Subscription ${data.invoice.externalSubscriptionId}`
              : data.invoice.externalCustomerId ?? undefined}
            colorScheme="teal"
          >
            <InvoiceDetail
              invoice={data.invoice}
              lagoDashboardUrl={data.lagoDashboardUrl}
              customerLagoId={data.customerLagoId}
              lagoInvoiceUrl={data.lagoInvoiceUrl}
            />
          </PageCard>
        )
        : (
          <PageCard
            title="Invoice not found"
            description={data.errorMessage ??
              "Lago did not return an invoice with that id."}
            colorScheme="teal"
          >
            <div className="text-sm text-muted-foreground">
              <a href="/invoices" className="text-teal-600 hover:underline">
                Return to invoices list
              </a>
            </div>
          </PageCard>
        )}
    </SidebarLayout>
  );
});
