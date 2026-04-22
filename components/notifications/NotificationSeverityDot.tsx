/**
 * NotificationSeverityDot
 *
 * A small colored dot indicating a notification's severity. Mapped per the
 * P1 plan:
 *   info    → sky
 *   success → emerald
 *   warn    → amber
 *   error   → rose
 *
 * `aria-hidden="true"` is always set — the dot is purely decorative. Every
 * row that uses it must render its severity as text as well so screen
 * readers never rely on color alone.
 */

import { cn } from "@/src/lib/utils/cn.ts";

export type NotificationSeverity = "info" | "success" | "warn" | "error";

const severityClasses: Record<NotificationSeverity, string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-rose-500",
};

interface NotificationSeverityDotProps {
  severity: NotificationSeverity;
  className?: string;
  /** Render a pulsing ring around the dot (e.g. for fresh unread rows). */
  pulse?: boolean;
}

export function NotificationSeverityDot({
  severity,
  className,
  pulse = false,
}: NotificationSeverityDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block size-2 rounded-full shrink-0",
        severityClasses[severity],
        className,
      )}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 rounded-full animate-ping opacity-60",
            severityClasses[severity],
          )}
        />
      )}
    </span>
  );
}
