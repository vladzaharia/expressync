/**
 * /billing/invoices/[id] — customer invoice detail.
 *
 * Polaris Track G3 — read-only customer view of one Lago invoice. Loader
 * runs the same ownership check the API enforces (assertOwnership +
 * external_customer_id cross-check). On miss returns a 404-style "not
 * found" PageCard rather than redirecting.
 */

import { define } from "../../../utils.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { BackAction } from "../../../components/shared/BackAction.tsx";
import { InvoiceStatusBadge } from "../../../components/shared/InvoiceStatusBadge.tsx";
import CustomerInvoiceSummary from "../../../islands/customer/CustomerInvoiceSummary.tsx";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { config } from "../../../src/lib/config.ts";
import {
  assertOwnership,
  OwnershipError,
  resolveCustomerScope,
} from "../../../src/lib/scoping.ts";
import {
  deriveInvoiceUiStatus,
  extractInvoiceCustomer,
  type InvoiceUiStatus,
} from "../../../src/lib/invoice-ui.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerInvoiceDetailPage");

interface InvoiceLine {
  label: string;
  sublabel?: string;
  amountCents: number;
  currency: string;
}

interface LoaderData {
  invoice: {
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
    periodStartIso: string | null;
    periodEndIso: string | null;
    lines: InvoiceLine[];
    lagoInvoiceUrl: string | null;
  } | null;
  errorMessage: string | null;
}

/**
 * Convert a Lago `fees` array entry into our compact InvoiceLine. Lago's
 * fee shape is heterogeneous (subscription vs charge vs commitment); we
 * pull the safest fields with sensible fallbacks rather than schema-narrow.
 */
function mapFeeToLine(fee: unknown, fallbackCurrency: string): InvoiceLine {
  const f = fee as Record<string, unknown>;
  const item = (f.item ?? {}) as Record<string, unknown>;
  const label = (item.name as string | undefined) ??
    (f.invoice_display_name as string | undefined) ??
    (item.code as string | undefined) ??
    "Line item";
  const units = f.units !== undefined ? String(f.units) : null;
  const grouping = (f.grouped_by as Record<string, unknown> | undefined) ??
    null;
  const sublabel = grouping
    ? Object.values(grouping).map(String).join(" · ")
    : units
    ? `${units} units`
    : undefined;
  const amount = typeof f.amount_cents === "number"
    ? f.amount_cents
    : typeof f.total_amount_cents === "number"
    ? (f.total_amount_cents as number)
    : 0;
  const currency = typeof f.amount_currency === "string"
    ? (f.amount_currency as string)
    : fallbackCurrency;
  return { label, sublabel, amountCents: amount, currency };
}

export const handler = define.handlers({
  async GET(ctx) {
    const id = ctx.params.id;
    if (!id) {
      return {
        data: {
          invoice: null,
          errorMessage: "Missing invoice id",
        } satisfies LoaderData,
      };
    }

    try {
      // Ownership pre-check — same shape as the API endpoint.
      await assertOwnership(ctx, "invoice", id);
      const scope = await resolveCustomerScope(ctx);

      const { invoice } = await lagoClient.getInvoice(id);
      const { externalCustomerId } = extractInvoiceCustomer(invoice);
      if (
        !externalCustomerId ||
        externalCustomerId !== scope.lagoCustomerExternalId
      ) {
        return {
          data: {
            invoice: null,
            errorMessage: "Invoice not found",
          } satisfies LoaderData,
        };
      }

      // Pull the billing period off the first attached subscription if
      // available — used to build the cross-link to /sessions.
      const subs = invoice.subscriptions as
        | Array<Record<string, unknown>>
        | undefined;
      const periodStartIso = (subs?.[0]?.current_billing_period_started_at as
        | string
        | undefined) ?? null;
      const periodEndIso = (subs?.[0]?.current_billing_period_ending_at as
        | string
        | undefined) ?? null;

      const fees = (invoice.fees ?? []) as unknown[];
      const lines: InvoiceLine[] = fees.map((fee) =>
        mapFeeToLine(fee, invoice.currency)
      );

      const lagoInvoiceUrl = config.LAGO_DASHBOARD_URL
        ? `${config.LAGO_DASHBOARD_URL}/invoices/${
          encodeURIComponent(invoice.lago_id)
        }/overview`
        : null;

      return {
        data: {
          invoice: {
            id: invoice.lago_id,
            number: invoice.number,
            status: invoice.status as
              | "draft"
              | "finalized"
              | "voided"
              | "failed"
              | "pending",
            paymentStatus: invoice.payment_status as
              | "pending"
              | "succeeded"
              | "failed",
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
            periodStartIso,
            periodEndIso,
            lines,
            lagoInvoiceUrl,
          },
          errorMessage: null,
        } satisfies LoaderData,
      };
    } catch (err) {
      if (err instanceof OwnershipError) {
        return {
          data: {
            invoice: null,
            errorMessage: "Invoice not found",
          } satisfies LoaderData,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      log.error("Failed to load customer invoice", err as Error);
      return {
        data: {
          invoice: null,
          errorMessage: message,
        } satisfies LoaderData,
      };
    }
  },
});

export default define.page<typeof handler>(function CustomerInvoiceDetailPage(
  { data, url, state },
) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      role="customer"
      accentColor="teal"
      actions={<BackAction href="/billing" />}
    >
      {data.invoice
        ? (
          <PageCard
            title={`Invoice ${data.invoice.number}`}
            description={data.invoice.periodStartIso
              ? `Billing period starting ${
                data.invoice.periodStartIso.slice(
                  0,
                  10,
                )
              }`
              : undefined}
            colorScheme="teal"
            headerActions={
              <InvoiceStatusBadge status={data.invoice.uiStatus} />
            }
          >
            <CustomerInvoiceSummary invoice={data.invoice} />
          </PageCard>
        )
        : (
          <PageCard
            title="Invoice not found"
            description={data.errorMessage ??
              "We couldn't find that invoice on your account."}
            colorScheme="teal"
          >
            <p className="text-sm text-muted-foreground">
              <a href="/billing" className="text-teal-600 hover:underline">
                Return to Billing
              </a>
            </p>
          </PageCard>
        )}
    </SidebarLayout>
  );
});
