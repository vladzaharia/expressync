/**
 * Right-side actions for the charger header strip:
 *   - Active-session mini-summary ("Charging on C1 · 18 min · tag ABC")
 *     that's visible only when a session is running. Telemetry (kW/kWh)
 *     stays in the affected ConnectorCard — too much motion noise on
 *     the page header otherwise.
 *   - Refresh-from-StEvE icon button. Idle = Refresh icon, in-flight =
 *     spinning icon, error = inline rose dot tooltip. Cooldown matches
 *     the existing per-card refresh button.
 *
 * Kept as a tiny island so the rest of the strip stays server-rendered.
 */

import { useState } from "preact/hooks";
import { AlertCircle, RefreshCw } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  formatSessionDuration,
  REFRESH_COOLDOWN_MS,
} from "@/islands/shared/device-visuals.ts";

export interface ChargerActiveSessionSummary {
  transactionId: number;
  connectorId: number;
  startTimestampIso: string;
  /** Tag id-tag string (best-effort — undisclosed if it would leak PII). */
  idTag: string | null;
}

interface Props {
  chargeBoxId: string;
  activeSession: ChargerActiveSessionSummary | null;
}

export default function ChargerStatusStripActions(
  { chargeBoxId, activeSession }: Props,
) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const onRefresh = async () => {
    const now = Date.now();
    if (refreshing || now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
    setRefreshing(true);
    setRefreshError(null);
    setLastRefreshAt(now);
    try {
      const res = await fetch("/api/admin/charger/operation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId,
          operation: "TriggerMessage",
          params: { triggerMessage: "StatusNotification" },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Refresh failed (HTTP ${res.status})`);
      }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  };

  return (
    <div class="flex items-center gap-3">
      {activeSession && (
        <a
          href={`/transactions/${activeSession.transactionId}`}
          class="hidden items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300 sm:inline-flex"
          title={`Open transaction #${activeSession.transactionId}`}
        >
          <span class="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
          Charging on C{activeSession.connectorId}
          <span class="opacity-80">
            · {formatSessionDuration(activeSession.startTimestampIso)}
          </span>
          {activeSession.idTag && (
            <span class="font-mono opacity-80">· {activeSession.idTag}</span>
          )}
        </a>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title={refreshError
          ? `Refresh failed: ${refreshError}`
          : refreshing
          ? "Refreshing…"
          : "Refresh from StEvE"}
        aria-label="Refresh from StEvE"
        class={cn(
          "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          refreshing && "opacity-60",
        )}
      >
        {refreshError
          ? <AlertCircle class="size-4 text-rose-500" />
          : (
            <RefreshCw
              class={cn("size-4", refreshing && "animate-spin")}
              aria-hidden="true"
            />
          )}
      </button>
    </div>
  );
}
