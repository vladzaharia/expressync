/**
 * Live status card (island). Shows:
 *   - Big OCPP status pill (uses `normalizeStatus` + `STATUS_HALO`).
 *   - Last-heartbeat relative time.
 *   - Active session summary (kW / kWh / duration) with a BorderBeam while
 *     charging — the same "charging is genuine live state" visual vocabulary
 *     established by `ChargerCard`.
 *   - `Refresh from StEvE` button fires a `TriggerMessage(StatusNotification)`
 *     op via `/api/admin/charger/operation`. Uses the shared `REFRESH_COOLDOWN_MS`
 *     so the per-card and detail-page buttons behave the same way.
 */

import { useState } from "preact/hooks";
import { AlertCircle, RefreshCw } from "lucide-preact";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  formatRelative,
  formatSessionDuration,
  REFRESH_COOLDOWN_MS,
  STATUS_HALO,
  type UiStatus,
} from "./shared/charger-visuals.ts";

interface ActiveSession {
  transactionId: number;
  connectorId: number;
  startTimestampIso: string;
  currentKw: number | null;
  sessionKwh: number | null;
  idTag: string;
}

interface Props {
  chargeBoxId: string;
  uiStatus: UiStatus;
  lastStatus: string | null;
  lastStatusAtIso: string | null;
  isStale: boolean;
  isOffline: boolean;
  activeSession: ActiveSession | null;
  steveFetchFailed: boolean;
  class?: string;
}

function toneForStatus(status: UiStatus): string {
  switch (status) {
    case "Available":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40";
    case "Charging":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
    case "Reserved":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/40";
    case "Faulted":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40";
    case "Unavailable":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40";
    case "Offline":
    default:
      return "bg-muted text-muted-foreground border-muted";
  }
}

export default function ChargerLiveStatusCard({
  chargeBoxId,
  uiStatus,
  lastStatus,
  lastStatusAtIso,
  isStale,
  isOffline,
  activeSession,
  steveFetchFailed,
  class: className,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const handleRefresh = async () => {
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
      setRefreshedAt(new Date());
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  };

  return (
    <div
      class={cn(
        "relative flex h-full flex-col gap-4 overflow-hidden rounded-xl border bg-card p-5",
        isStale && "opacity-80",
        isOffline && "border-dashed",
        className,
      )}
    >
      {steveFetchFailed && (
        <div
          role="alert"
          class="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertCircle class="size-4" />
          <span>
            StEvE is unreachable — live status below is from the local cache and
            may be out of date.
          </span>
        </div>
      )}

      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1.5">
          <div class="text-xs uppercase tracking-wide text-muted-foreground">
            Current status
          </div>
          <div
            role="status"
            aria-live="polite"
            class={cn(
              "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-base font-semibold",
              toneForStatus(uiStatus),
            )}
          >
            <span
              aria-hidden="true"
              class="inline-block size-2.5 rounded-full"
              style={{ background: STATUS_HALO[uiStatus] }}
            />
            {uiStatus}
            {lastStatus &&
              lastStatus.toLowerCase() !== uiStatus.toLowerCase() &&
              (
                <span class="text-xs font-normal opacity-80">
                  ({lastStatus})
                </span>
              )}
          </div>
          <div class="text-xs text-muted-foreground">
            Last heartbeat {formatRelative(lastStatusAtIso)}
          </div>
        </div>

        <div class="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Trigger a StatusNotification refresh"
          >
            <RefreshCw class={cn("size-4", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing…" : "Refresh from StEvE"}
          </Button>
          {refreshedAt && !refreshError && (
            <span class="text-[11px] text-muted-foreground">
              Requested at {refreshedAt.toLocaleTimeString()}
            </span>
          )}
          {refreshError && (
            <span class="text-[11px] text-rose-600">{refreshError}</span>
          )}
        </div>
      </div>

      {/* Session summary */}
      {activeSession
        ? (
          <div class="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <div class="text-xs text-muted-foreground">Transaction</div>
              <a
                href={`/transactions/${activeSession.transactionId}`}
                class="font-mono text-xs font-medium hover:underline"
              >
                #{activeSession.transactionId}
              </a>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Connector</div>
              <div class="font-medium">{activeSession.connectorId}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Power</div>
              <div class="font-medium">
                {activeSession.currentKw !== null
                  ? `${activeSession.currentKw.toFixed(2)} kW`
                  : "—"}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Energy</div>
              <div class="font-medium">
                {activeSession.sessionKwh !== null
                  ? `${activeSession.sessionKwh.toFixed(2)} kWh`
                  : "—"}
              </div>
            </div>
            <div class="col-span-2 sm:col-span-4 flex items-center justify-between text-xs">
              <span class="text-muted-foreground">
                Elapsed {formatSessionDuration(activeSession.startTimestampIso)}
              </span>
              <span class="font-mono text-[11px] text-muted-foreground">
                tag {activeSession.idTag}
              </span>
            </div>
          </div>
        )
        : (
          <div class="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
            No active session.
          </div>
        )}

      {uiStatus === "Charging" && activeSession && (
        <BorderBeam
          size={180}
          duration={8}
          colorFrom="oklch(0.75 0.15 145)"
          colorTo="oklch(0.70 0.18 150)"
        />
      )}
    </div>
  );
}
