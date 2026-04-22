import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface WebhookTypeBadgeProps {
  webhookType: string;
  className?: string;
}

/**
 * Renders a Lago `webhook_type` string as a muted, slate-accented chip.
 *
 * Family (namespace before the dot) sets the color intensity so the eye can
 * scan many rows quickly:
 *   - invoice.*           → teal-outline (cross-domain to Invoices)
 *   - alert.*             → amber-outline
 *   - wallet_transaction.*→ indigo-outline
 *   - customer.*          → cyan-outline
 *   - subscription.*      → violet-outline
 *   - credit_note.*       → rose-outline
 *   - payment*.*          → emerald-outline
 *   - fee.*               → slate-outline
 *   - default             → slate-outline
 *
 * Cross-domain rule: always outlined (never filled) so primary accents stay
 * reserved for the own-domain surface.
 */
export function WebhookTypeBadge(
  { webhookType, className }: WebhookTypeBadgeProps,
) {
  const family = webhookType.split(".")[0] ?? "unknown";

  const familyStyles: Record<string, string> = {
    invoice: "border-teal-500/40 text-teal-700 dark:text-teal-300",
    alert: "border-amber-500/40 text-amber-700 dark:text-amber-300",
    wallet_transaction:
      "border-indigo-500/40 text-indigo-700 dark:text-indigo-300",
    customer: "border-cyan-500/40 text-cyan-700 dark:text-cyan-300",
    subscription: "border-violet-500/40 text-violet-700 dark:text-violet-300",
    credit_note: "border-rose-500/40 text-rose-700 dark:text-rose-300",
    payment_request:
      "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    payment_receipt:
      "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    fee: "border-slate-500/40 text-slate-600 dark:text-slate-400",
    event: "border-slate-500/40 text-slate-600 dark:text-slate-400",
  };

  const tone = familyStyles[family] ??
    "border-slate-500/40 text-slate-600 dark:text-slate-400";

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[0.7rem] uppercase tracking-wide",
        tone,
        className,
      )}
      title={webhookType}
    >
      {webhookType}
    </Badge>
  );
}
