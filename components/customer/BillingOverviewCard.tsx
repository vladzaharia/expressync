/**
 * BillingOverviewCard — "What do I owe right now?" pay-now pill.
 *
 * State machine (in precedence order):
 *   - failedCount > 0        → rose  + "Contact operator" mailto
 *   - overdueCents > 0       → amber + "View open invoices"
 *   - openCents > 0          → blue  + "View open invoices"
 *   - paidUp === true        → emerald tick + "You're all paid up."
 *   - else                   → muted "No balance due."
 */

import type { ComponentChildren } from "preact";
import { CheckCircle2, CircleAlert, CircleDollarSign, Mail } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { MoneyBadge } from "@/components/billing/MoneyBadge.tsx";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface BillingOverviewData {
  openCents: number;
  overdueCents: number;
  failedCount: number;
  nextInvoiceDateIso: string | null;
  nextInvoiceEstimateCents: number | null;
  currency: string;
  /** All finalized invoices paid? (openCents === 0 && failedCount === 0). */
  paidUp: boolean;
  /** Earliest payment_due_date across open invoices, if any. */
  nextDueDateIso: string | null;
  operatorEmail?: string;
}

interface Props extends BillingOverviewData {
  accent?: AccentColor;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BillingOverviewCard({
  openCents,
  overdueCents,
  failedCount,
  nextInvoiceDateIso,
  nextInvoiceEstimateCents,
  currency,
  paidUp,
  nextDueDateIso,
  operatorEmail,
  accent = "blue",
}: Props) {
  // Resolve effective tone.
  let tone: AccentColor | "muted" = "muted";
  if (failedCount > 0) tone = "rose";
  else if (overdueCents > 0) tone = "amber";
  else if (openCents > 0) tone = accent;
  else if (paidUp) tone = "emerald";

  const toneClass = stripToneClasses[tone];

  // Paid-up state.
  if (paidUp && openCents === 0 && failedCount === 0) {
    return (
      <div
        class={cn(
          "flex items-center gap-3 rounded-lg border p-4",
          toneClass.cell,
        )}
      >
        <span
          class={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            toneClass.iconWell,
          )}
          aria-hidden="true"
        >
          <CheckCircle2 class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">You're all paid up.</p>
          {nextInvoiceDateIso && (
            <p class="text-xs text-muted-foreground">
              Next invoice {formatDate(nextInvoiceDateIso)}
              {nextInvoiceEstimateCents != null &&
                  nextInvoiceEstimateCents > 0 && (
                <>
                  {" · estimate "}
                  <MoneyBadge
                    cents={nextInvoiceEstimateCents}
                    currency={currency}
                  />
                </>
              )}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Empty state — no Lago-side balance info to show at all.
  if (openCents === 0 && failedCount === 0 && overdueCents === 0) {
    return (
      <div
        class={cn(
          "flex items-center gap-3 rounded-lg border p-4",
          toneClass.cell,
        )}
      >
        <span
          class={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            toneClass.iconWell,
          )}
          aria-hidden="true"
        >
          <CircleDollarSign class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">No balance due.</p>
          {nextInvoiceDateIso && (
            <p class="text-xs text-muted-foreground">
              Next invoice {formatDate(nextInvoiceDateIso)}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Open / overdue / failed — show the amount + due + action.
  const primaryIcon = failedCount > 0 ? CircleAlert : CircleDollarSign;
  const PrimaryIcon = primaryIcon;

  const showingCents = openCents > 0 ? openCents : overdueCents;
  const dueLabel = formatDate(nextDueDateIso);

  const actionHref = failedCount > 0 && operatorEmail
    ? `mailto:${operatorEmail}?subject=${
      encodeURIComponent("Payment issue on my account")
    }`
    : "/billing?status=open#invoices";
  const actionLabel = failedCount > 0 ? "Contact operator" : "View open invoices";
  const actionIcon: ComponentChildren = failedCount > 0
    ? <Mail class="size-4" aria-hidden="true" />
    : null;

  return (
    <div
      class={cn(
        "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center",
        toneClass.cell,
      )}
    >
      <span
        class={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          toneClass.iconWell,
        )}
        aria-hidden="true"
      >
        <PrimaryIcon class="size-5" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          {failedCount > 0
            ? "Payment failed"
            : overdueCents > 0
            ? "Amount overdue"
            : "Amount due"}
        </p>
        <p class="text-xl font-semibold leading-tight tabular-nums">
          <MoneyBadge cents={showingCents} currency={currency} />
        </p>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {dueLabel && <span>Due {dueLabel}</span>}
          {overdueCents > 0 && failedCount === 0 && (
            <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Overdue
            </span>
          )}
          {failedCount > 0 && (
            <span class="rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              {failedCount === 1 ? "1 payment failed" : `${failedCount} payments failed`}
            </span>
          )}
        </p>
      </div>
      <div class="shrink-0">
        {actionHref.startsWith("mailto:") && !operatorEmail
          ? null
          : (
            <Button asChild size="sm">
              <a href={actionHref}>
                {actionIcon}
                <span>{actionLabel}</span>
              </a>
            </Button>
          )}
      </div>
    </div>
  );
}
