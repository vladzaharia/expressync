import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { config } from "../../src/lib/config.ts";
import InvoicesTable from "../../islands/invoices/InvoicesTable.tsx";
import InvoiceFilters from "../../islands/invoices/InvoiceFilters.tsx";
import { MoneyBadge } from "../../components/billing/MoneyBadge.tsx";
import { BlurFade } from "../../components/magicui/blur-fade.tsx";
import {
  StatStrip,
  type StatStripItem,
} from "../../components/shared/StatStrip.tsx";
import {
  deriveInvoiceUiStatus,
  extractInvoiceCustomer,
  extractInvoiceSubscription,
  type InvoiceListDTO,
  type InvoiceUiStatus,
} from "../../src/lib/invoice-ui.ts";
import { AlertTriangle, Clock, FileText, Wallet } from "lucide-preact";

const PAGE_SIZE = 50;

interface LoaderData {
  rows: InvoiceListDTO[];
  stats: {
    unpaidCount: number;
    unpaidCents: number;
    paidThisMonthCents: number;
    overdueCount: number;
    currency: string;
  };
  filters: {
    status: InvoiceUiStatus[];
    search: string;
    issuingDateFrom: string;
    issuingDateTo: string;
    customerId: string;
  };
  customerLagoIds: Record<string, string>;
  lagoDashboardUrl: string;
  steveFetchFailed: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const statusFilter = url.searchParams.getAll("status") as InvoiceUiStatus[];
    const search = url.searchParams.get("search") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const customerId = url.searchParams.get("customerId") ?? "";

    // Map UI status to Lago filter args where possible.
    const lagoStatus: string[] = [];
    const lagoPaymentStatus: string[] = [];
    let paymentOverdue: boolean | undefined;
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
          paymentOverdue = true;
          break;
      }
    }

    let rows: InvoiceListDTO[] = [];
    let unpaidCount = 0;
    let unpaidCents = 0;
    let paidThisMonthCents = 0;
    let overdueCount = 0;
    let currency = "EUR";
    let steveFetchFailed = false;

    try {
      const { invoices } = await lagoClient.listInvoices({
        page: 1,
        perPage: PAGE_SIZE,
        status: lagoStatus.length > 0 ? lagoStatus : undefined,
        paymentStatus: lagoPaymentStatus.length > 0
          ? lagoPaymentStatus
          : undefined,
        paymentOverdue,
        issuingDateFrom: from || undefined,
        issuingDateTo: to || undefined,
        searchTerm: search || undefined,
        externalCustomerId: customerId || undefined,
      });

      if (invoices[0]) currency = invoices[0].currency;

      rows = invoices
        .map((inv) => {
          const { externalCustomerId, customerName } = extractInvoiceCustomer(
            inv,
          );
          return {
            id: inv.lago_id,
            number: inv.number,
            status: inv.status,
            paymentStatus: inv.payment_status,
            uiStatus: deriveInvoiceUiStatus({
              status: inv.status,
              payment_status: inv.payment_status,
              payment_overdue: inv.payment_overdue,
            }),
            totalCents: inv.total_amount_cents,
            currency: inv.currency,
            issuingDateIso: inv.issuing_date,
            paymentDueDateIso: inv.payment_due_date ?? null,
            payoutOverdue: Boolean(inv.payment_overdue),
            externalCustomerId,
            customerName,
            externalSubscriptionId: extractInvoiceSubscription(inv),
            fileUrl: inv.file_url ?? null,
            invoiceType: inv.invoice_type ?? null,
          } satisfies InvoiceListDTO;
        })
        .filter((row) =>
          statusFilter.length === 0 || statusFilter.includes(row.uiStatus)
        );

      // Stats are computed against the full unfiltered "open books" set so
      // the strip stays meaningful regardless of filter selection.
      const statsResp = await lagoClient.listInvoices({
        page: 1,
        perPage: 100,
      });
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString().slice(0, 10);
      for (const inv of statsResp.invoices) {
        if (inv.status === "finalized" && inv.payment_status !== "succeeded") {
          unpaidCount += 1;
          unpaidCents += inv.total_amount_cents;
        }
        if (
          inv.status === "finalized" &&
          inv.payment_status === "succeeded" &&
          inv.issuing_date >= startOfMonth
        ) {
          paidThisMonthCents += inv.total_amount_cents;
        }
        if (inv.payment_overdue && inv.status === "finalized") {
          overdueCount += 1;
        }
      }
    } catch (error) {
      console.error("Failed to list invoices", error);
      steveFetchFailed = true;
    }

    // Fetch customer lago_ids to build external links.
    const customerLagoIds = new Map<string, string>();
    try {
      const { customers } = await lagoClient.getCustomers();
      for (const c of customers) {
        customerLagoIds.set(c.external_id, c.lago_id);
      }
    } catch (error) {
      console.warn("Failed to load Lago customers for invoice page", error);
    }

    const data: LoaderData = {
      rows,
      stats: {
        unpaidCount,
        unpaidCents,
        paidThisMonthCents,
        overdueCount,
        currency,
      },
      filters: {
        status: statusFilter,
        search,
        issuingDateFrom: from,
        issuingDateTo: to,
        customerId,
      },
      customerLagoIds: Object.fromEntries(customerLagoIds),
      lagoDashboardUrl: config.LAGO_DASHBOARD_URL,
      steveFetchFailed,
    };

    return { data };
  },
});

export default define.page<typeof handler>(function InvoicesIndexPage({
  data,
  url,
  state,
}) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      accentColor="teal"
    >
      <PageCard
        title="Invoices"
        description={`${data.rows.length} invoice${
          data.rows.length === 1 ? "" : "s"
        } match current filters`}
        colorScheme="teal"
      >
        {data.steveFetchFailed && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300"
          >
            Failed to load invoices from Lago. Results below may be stale.
          </div>
        )}

        <BlurFade direction="up" duration={0.35}>
          <div className="mb-6">
            <StatStrip
              accent="teal"
              items={[
                {
                  key: "unpaid",
                  label: `Unpaid · ${data.stats.unpaidCount}`,
                  value: (
                    <MoneyBadge
                      cents={data.stats.unpaidCents}
                      currency={data.stats.currency}
                    />
                  ),
                  icon: Wallet,
                },
                {
                  key: "paid",
                  label: "Paid this month",
                  value: (
                    <MoneyBadge
                      cents={data.stats.paidThisMonthCents}
                      currency={data.stats.currency}
                    />
                  ),
                  icon: FileText,
                  tone: "emerald",
                },
                {
                  key: "overdue",
                  label: "Overdue",
                  value: data.stats.overdueCount,
                  icon: AlertTriangle,
                  warn: data.stats.overdueCount > 0,
                },
                {
                  key: "cycle",
                  label: "Cycle",
                  value: "Last 30 days",
                  icon: Clock,
                  tone: "muted",
                },
              ] satisfies StatStripItem[]}
            />
          </div>
        </BlurFade>

        <div className="mb-6">
          <InvoiceFilters initial={data.filters} />
        </div>

        <InvoicesTable
          invoices={data.rows}
          lagoDashboardUrl={data.lagoDashboardUrl}
          customerLagoIds={data.customerLagoIds}
        />
      </PageCard>
    </SidebarLayout>
  );
});
