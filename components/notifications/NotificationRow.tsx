/**
 * NotificationRow
 *
 * Dense row rendering used by both the header bell dropdown AND the archive
 * page table body. Shows severity dot + title + body snippet + relative time
 * + outlined source chip (cross-domain accent via the destination color).
 *
 * Source chip accent mapping (plan P1 — outlined only, never filled):
 *   invoice            → teal
 *   alert              → rose
 *   subscription       → violet (matches Links accent)
 *   wallet_transaction → amber
 *   webhook_event      → slate (admin/technical)
 *   mapping            → violet
 *   charger            → orange
 *   reservation        → indigo
 *   system             → slate (no link)
 */

import type { ComponentChildren } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  type NotificationSeverity,
  NotificationSeverityDot,
} from "./NotificationSeverityDot.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { ExternalLink } from "lucide-preact";

export interface NotificationRowItem {
  id: number;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

interface NotificationRowProps {
  notification: NotificationRowItem;
  /** Render as a compact row (bell dropdown) or standard row (archive). */
  compact?: boolean;
  /** Called when the row is activated (click/enter) — used for "mark read +
   *  navigate". If omitted, the row behaves as a plain non-interactive block. */
  onActivate?: (n: NotificationRowItem) => void;
  className?: string;
}

/**
 * Text label for a source type, used inside the outlined chip. Unknown types
 * fall back to the raw string so a future source appears in the UI before
 * the frontend is updated.
 */
function sourceLabel(sourceType: string | null): string {
  if (!sourceType) return "System";
  switch (sourceType) {
    case "invoice":
      return "Invoice";
    case "alert":
      return "Alert";
    case "subscription":
      return "Subscription";
    case "wallet_transaction":
      return "Wallet";
    case "webhook_event":
      return "Webhook";
    case "mapping":
      return "Link";
    case "charger":
      return "Charger";
    case "reservation":
      return "Reservation";
    case "system":
      return "System";
    default:
      return sourceType.charAt(0).toUpperCase() + sourceType.slice(1);
  }
}

/** Outlined-only chip classes per source type. Never filled. */
function sourceChipClasses(sourceType: string | null): string {
  switch (sourceType) {
    case "invoice":
      return "border-teal-500/50 text-teal-700 dark:text-teal-400";
    case "alert":
      return "border-rose-500/50 text-rose-700 dark:text-rose-400";
    case "subscription":
    case "mapping":
      return "border-violet-500/50 text-violet-700 dark:text-violet-400";
    case "wallet_transaction":
      return "border-amber-500/50 text-amber-700 dark:text-amber-400";
    case "webhook_event":
      return "border-slate-500/50 text-slate-700 dark:text-slate-400";
    case "charger":
      return "border-orange-500/50 text-orange-700 dark:text-orange-400";
    case "reservation":
      return "border-indigo-500/50 text-indigo-700 dark:text-indigo-400";
    case "system":
    default:
      return "border-slate-400/50 text-slate-600 dark:text-slate-400";
  }
}

/**
 * Very small relative-time formatter so this component has no third-party
 * dependency. Matches the tone of other existing UI strings ("5m ago").
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.round(d / 365);
  return `${y}y ago`;
}

/** Severity label for screen readers — paired with the decorative dot. */
function severityLabel(severity: NotificationSeverity): string {
  switch (severity) {
    case "info":
      return "Info";
    case "success":
      return "Success";
    case "warn":
      return "Warning";
    case "error":
      return "Error";
  }
}

export function NotificationRow({
  notification: n,
  compact = false,
  onActivate,
  className,
}: NotificationRowProps) {
  const isUnread = n.readAt === null;
  const label = sourceLabel(n.sourceType);
  const chipClass = sourceChipClasses(n.sourceType);
  const relative = formatRelative(n.createdAt);
  const absolute = new Date(n.createdAt).toLocaleString();

  const interactive = typeof onActivate === "function";

  const chip: ComponentChildren = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-[10px] uppercase tracking-wide font-medium",
        chipClass,
      )}
    >
      {label}
      {n.sourceUrl && !n.sourceUrl.startsWith("/") && (
        <ExternalLink className="size-3" aria-hidden="true" />
      )}
    </Badge>
  );

  const content = (
    <>
      <div className="flex items-start gap-3 min-w-0">
        <NotificationSeverityDot
          severity={n.severity}
          pulse={isUnread}
          className="mt-1.5"
        />
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-sm font-medium truncate",
                isUnread ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {n.title}
            </span>
            <span className="sr-only">{severityLabel(n.severity)}.</span>
            {chip}
          </div>
          <p
            className={cn(
              "text-xs leading-snug",
              compact ? "line-clamp-2" : "line-clamp-3",
              isUnread ? "text-muted-foreground" : "text-muted-foreground/80",
            )}
          >
            {n.body}
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            <time dateTime={n.createdAt} title={absolute}>{relative}</time>
          </p>
        </div>
      </div>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={() => onActivate?.(n)}
        className={cn(
          "w-full text-left px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md",
          isUnread && "bg-muted/20",
          className,
        )}
        aria-label={`${severityLabel(n.severity)}: ${n.title}. ${
          isUnread ? "Unread." : ""
        } From ${label}.`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "px-3 py-2.5",
        isUnread && "bg-muted/20",
        className,
      )}
    >
      {content}
    </div>
  );
}
