import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { InvoiceStatusChip } from "@/components/billing/InvoiceStatusChip.tsx";
import { CustomerChip } from "@/components/billing/CustomerChip.tsx";
import InvoicePdfLink from "./InvoicePdfLink.tsx";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-preact";
import {
  deriveInvoiceUiStatus,
  formatMoney,
  type InvoiceUiStatus,
} from "@/src/lib/invoice-ui.ts";

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

interface Props {
  invoice: InvoiceDetailState;
  lagoDashboardUrl?: string;
  customerLagoId?: string | null;
  lagoInvoiceUrl?: string | null;
}

/**
 * Client-side control surface for the invoice detail page.
 *
 * - Polls `/refresh` every 5s up to 60s when `uiStatus === "pending"`
 *   (AbortController bound to the effect for clean unmount).
 * - Exposes four admin ops: Finalize, Retry Payment, Void, Refresh.
 * - Retry + Void are gated behind safe-default confirm dialogs.
 */
export default function InvoiceDetail(
  { invoice, lagoDashboardUrl, customerLagoId, lagoInvoiceUrl }: Props,
) {
  const state = useSignal<InvoiceDetailState>(invoice);
  const busy = useSignal<null | "finalize" | "retry" | "void" | "refresh">(
    null,
  );
  const showRetryDialog = useSignal(false);
  const showVoidDialog = useSignal(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Poll `/refresh` while pending.
  useEffect(() => {
    if (state.value.uiStatus !== "pending") return;
    const ac = new AbortController();
    const started = Date.now();

    (async () => {
      while (!ac.signal.aborted && Date.now() - started < 60_000) {
        await new Promise((r) => setTimeout(r, 5_000));
        if (ac.signal.aborted) return;
        try {
          const res = await fetch(
            `/api/invoice/${encodeURIComponent(state.value.id)}/refresh`,
            { method: "POST", signal: ac.signal },
          );
          if (!res.ok) continue;
          const next = await res.json().catch(() => null);
          if (!next) continue;
          applyServerUpdate(next);
          if (state.value.uiStatus !== "pending") return;
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            console.error("InvoiceDetail refresh poll failed", err);
          }
        }
      }
    })();

    return () => ac.abort();
  }, [state.value.uiStatus, state.value.id]);

  const applyServerUpdate = (payload: Partial<InvoiceDetailState>) => {
    const merged: InvoiceDetailState = { ...state.value, ...payload };
    merged.uiStatus = deriveInvoiceUiStatus({
      status: merged.status,
      payment_status: merged.paymentStatus,
      payment_overdue: merged.paymentOverdue,
    });
    state.value = merged;
  };

  const run = async (
    kind: "finalize" | "retry" | "void" | "refresh",
  ) => {
    if (busy.value) return;
    busy.value = kind;
    const urlPath = {
      finalize: "finalize",
      retry: "retry_payment",
      void: "void",
      refresh: "refresh",
    }[kind];
    try {
      const res = await fetch(
        `/api/invoice/${encodeURIComponent(state.value.id)}/${urlPath}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error ?? `Failed to ${kind} invoice`);
        return;
      }

      if (kind === "retry") {
        // Optimistic flip to pending; detail effect will poll /refresh.
        applyServerUpdate({
          paymentStatus: "pending",
        });
        toast.success("Payment retry queued");
        return;
      }

      const data = await res.json().catch(() => ({}));
      applyServerUpdate(data ?? {});
      toast.success(
        kind === "finalize"
          ? "Invoice finalized"
          : kind === "void"
          ? "Invoice voided"
          : "Refreshed from Lago",
      );
    } catch (err) {
      console.error("Invoice op failed", err);
      toast.error(`Failed to ${kind} invoice`);
    } finally {
      busy.value = null;
      showRetryDialog.value = false;
      showVoidDialog.value = false;
    }
  };

  // Focus the safe "Cancel" button on open
  useEffect(() => {
    if (!showVoidDialog.value && !showRetryDialog.value) return;
    const t = setTimeout(() => cancelButtonRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [showVoidDialog.value, showRetryDialog.value]);

  const canFinalize = state.value.status === "draft";
  const canVoid = state.value.status === "finalized" &&
    state.value.paymentStatus !== "succeeded";
  const canRetry = state.value.status === "finalized" &&
    (state.value.paymentStatus === "failed" || state.value.paymentOverdue);

  return (
    <div
      role="region"
      aria-label="Invoice detail"
      aria-live="polite"
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <InvoiceStatusChip status={state.value.uiStatus} />
          {state.value.paymentOverdue && (
            <Badge
              variant="outline"
              className="gap-1 border-rose-500/40 text-rose-700 dark:text-rose-300"
            >
              <AlertTriangle className="size-3" aria-hidden="true" />
              Overdue
            </Badge>
          )}
          <CustomerChip
            externalId={state.value.externalCustomerId}
            name={state.value.customerName}
            lagoDashboardUrl={lagoDashboardUrl}
            lagoId={customerLagoId ?? null}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InvoicePdfLink
            invoiceId={state.value.id}
            initialFileUrl={state.value.fileUrl}
          />
          {lagoInvoiceUrl && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={lagoInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in Lago (opens in new tab)"
              >
                Open in Lago
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          label="Total"
          value={formatMoney(state.value.totalCents, state.value.currency)}
          emphasis
        />
        <SummaryTile
          label="Fees"
          value={formatMoney(state.value.feesCents, state.value.currency)}
        />
        <SummaryTile
          label="Taxes"
          value={formatMoney(state.value.taxesCents, state.value.currency)}
        />
        <SummaryTile
          label="Issued"
          value={formatDate(state.value.issuingDateIso)}
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-2 border-t pt-4"
        role="group"
        aria-label="Invoice admin operations"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => run("refresh")}
          disabled={busy.value !== null}
        >
          <RefreshCw
            className={busy.value === "refresh"
              ? "size-4 animate-spin"
              : "size-4"}
            aria-hidden="true"
          />
          Refresh from Lago
        </Button>

        {canFinalize && (
          <Button
            variant="default"
            size="sm"
            onClick={() => run("finalize")}
            disabled={busy.value !== null}
          >
            Finalize
          </Button>
        )}

        {canRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => showRetryDialog.value = true}
            disabled={busy.value !== null}
          >
            Retry payment
          </Button>
        )}

        {canVoid && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => showVoidDialog.value = true}
            disabled={busy.value !== null}
          >
            Void invoice
          </Button>
        )}
      </div>

      {/* Retry payment confirm */}
      <Dialog
        open={showRetryDialog.value}
        onOpenChange={(v) => showRetryDialog.value = v}
      >
        <DialogContent onClose={() => showRetryDialog.value = false}>
          <DialogHeader>
            <DialogTitle>Retry payment?</DialogTitle>
            <DialogDescription>
              Lago will attempt to charge the customer's payment method again.
              The invoice will flip to <em>pending</em>{" "}
              until a webhook reports the outcome.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={cancelButtonRef}
              variant="outline"
              onClick={() => showRetryDialog.value = false}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => run("retry")}
              disabled={busy.value !== null}
            >
              Retry Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void confirm */}
      <Dialog
        open={showVoidDialog.value}
        onOpenChange={(v) => showVoidDialog.value = v}
      >
        <DialogContent onClose={() => showVoidDialog.value = false}>
          <DialogHeader>
            <DialogTitle>Void this invoice?</DialogTitle>
            <DialogDescription>
              Voiding marks the invoice as cancelled in Lago. This action cannot
              be undone and the invoice stays in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={cancelButtonRef}
              variant="outline"
              onClick={() => showVoidDialog.value = false}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => run("void")}
              disabled={busy.value !== null}
            >
              Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile(
  { label, value, emphasis }: {
    label: string;
    value: string;
    emphasis?: boolean;
  },
) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={emphasis
          ? "mt-1 text-2xl font-semibold tabular-nums text-teal-600 dark:text-teal-400"
          : "mt-1 text-lg font-semibold tabular-nums"}
      >
        {value}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
