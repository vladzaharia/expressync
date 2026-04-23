/**
 * Polaris Track E — inline charger picker for the customer scan-to-login modal.
 *
 * The picker only renders when more than one online charger exists. The
 * scan-to-login flow auto-skips this step when N=1 (server enforces the same
 * binding regardless), so this component is intentionally minimal.
 *
 * Each entry shows a friendly name (or chargeBoxId fallback), a small status
 * pill, and a "Select" button. We render selectable cards as a vertical list
 * because the friends-and-family deployments this targets typically have 2-3
 * chargers; if a deployment scales beyond ~6 it would warrant a different UI.
 */

import { cn } from "@/src/lib/utils/cn.ts";

export interface ChargerPickerCharger {
  chargeBoxId: string;
  friendlyName: string | null;
  status: string | null;
  online: boolean;
}

interface ChargerPickerInlineProps {
  chargers: ChargerPickerCharger[];
  onSelect: (chargeBoxId: string) => void;
  disabled?: boolean;
  className?: string;
}

function statusToneClass(status: string | null, online: boolean): string {
  if (!online) return "bg-muted text-muted-foreground border-border";
  const s = (status ?? "").toLowerCase();
  if (s === "available") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  }
  if (
    s === "occupied" || s === "charging" || s === "preparing" ||
    s === "finishing" || s === "suspendedev" || s === "suspendedevse"
  ) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  }
  if (s === "faulted" || s === "unavailable") {
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
  }
  return "bg-muted text-muted-foreground border-border";
}

function statusLabel(status: string | null, online: boolean): string {
  if (!online) return "Offline";
  if (!status) return "Unknown";
  // Title-case the OCPP status string for display.
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ChargerPickerInline({
  chargers,
  onSelect,
  disabled,
  className,
}: ChargerPickerInlineProps) {
  if (chargers.length === 0) return null;
  return (
    <ul class={cn("flex flex-col gap-2", className)}>
      {chargers.map((c) => {
        const tone = statusToneClass(c.status, c.online);
        const label = statusLabel(c.status, c.online);
        const name = c.friendlyName?.trim() || c.chargeBoxId;
        return (
          <li key={c.chargeBoxId}>
            <button
              type="button"
              disabled={disabled || !c.online}
              onClick={() => {
                if (!disabled && c.online) onSelect(c.chargeBoxId);
              }}
              class={cn(
                "group w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors",
                "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span class="flex flex-col min-w-0">
                <span class="text-sm font-semibold text-foreground truncate">
                  {name}
                </span>
                {c.friendlyName && c.friendlyName !== c.chargeBoxId
                  ? (
                    <span class="text-xs text-muted-foreground truncate font-mono">
                      {c.chargeBoxId}
                    </span>
                  )
                  : null}
              </span>
              <span class="flex items-center gap-2 shrink-0">
                <span
                  class={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide",
                    tone,
                  )}
                >
                  {label}
                </span>
                <span class="inline-flex items-center px-3 h-7 rounded-md border border-input bg-background text-xs font-medium text-foreground">
                  Select
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
