import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Lock, RefreshCw, StopCircle, Zap } from "lucide-preact";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { getDeviceIcon } from "@/src/lib/utils/device-icons.ts";
import { cn } from "@/src/lib/utils/cn.ts";

/**
 * DTO shape consumed by the charger card. Pre-serialized on the server so
 * the island stays free of Lago/StEvE client types and hydrates cheaply.
 */
export interface ChargerCardDto {
  chargeBoxId: string;
  chargeBoxPk: number | null;
  friendlyName: string | null;
  formFactor: string; // free-form at the edge; we map unknown → generic
  firstSeenAtIso: string;
  lastSeenAtIso: string;
  lastStatus: string | null;
  lastStatusAtIso: string | null;
}

export interface ActiveSessionDto {
  transactionId: number;
  startTimestampIso: string;
  currentKw: number | null;
  sessionKwh: number | null;
}

export interface ChargerCardProps {
  charger: ChargerCardDto;
  activeSession?: ActiveSessionDto;
  isAdmin?: boolean;
  onAction?: (op: string, params: Record<string, unknown>) => void;
}

import {
  formatRelative,
  formatSessionDuration,
  formatUptime,
  normalizeStatus,
  REFRESH_COOLDOWN_MS,
  STALE_DIM_MS,
  STATUS_HALO,
} from "./shared/device-visuals.ts";

export default function ChargerCard(
  { charger, activeSession, isAdmin = false, onAction }: ChargerCardProps,
) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(0);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
  const [pendingStop, setPendingStop] = useState(false);

  // Live kW chip — driven by `transaction.meter` SSE events filtered by this
  // card's chargeBoxId. Tracks per-connector kW since chargers can (rarely)
  // run multiple sessions; chip shows the max.
  const liveKw = useSignal<number | null>(null);
  useEffect(() => {
    const perConnector = new Map<
      string,
      { kw: number; lastSeen: number }
    >();
    let dirty = false;
    let flushHandle: number | null = null;

    const flush = () => {
      flushHandle = null;
      if (!dirty) return;
      dirty = false;
      const cutoff = Date.now() - 90_000;
      let max = 0;
      let any = false;
      for (const [k, v] of perConnector) {
        if (v.lastSeen < cutoff) {
          perConnector.delete(k);
          continue;
        }
        any = true;
        if (v.kw > max) max = v.kw;
      }
      liveKw.value = any ? max : null;
    };

    const schedule = () => {
      dirty = true;
      if (flushHandle !== null) return;
      flushHandle = setTimeout(flush, 250) as unknown as number;
    };

    const unsub = subscribeSse("transaction.meter", (raw) => {
      const p = raw as {
        transactionId: number | string;
        chargeBoxId?: string;
        connectorId?: number;
        powerKw?: number;
        endedAt?: string;
      };
      if (p.chargeBoxId !== charger.chargeBoxId) return;
      const key = `${p.connectorId ?? "_"}:${p.transactionId}`;
      if (p.endedAt) {
        perConnector.delete(key);
        schedule();
        return;
      }
      const kw = typeof p.powerKw === "number" && Number.isFinite(p.powerKw)
        ? Math.max(0, p.powerKw)
        : (perConnector.get(key)?.kw ?? 0);
      perConnector.set(key, { kw, lastSeen: Date.now() });
      schedule();
    });

    const sweep = setInterval(schedule, 5_000);

    return () => {
      unsub();
      clearInterval(sweep);
      if (flushHandle !== null) clearTimeout(flushHandle);
    };
  }, [charger.chargeBoxId]);

  const status = normalizeStatus(
    charger.lastStatus,
    charger.lastStatusAtIso,
    Boolean(activeSession),
  );

  // Staleness dimming — only when we *do* have a status but it's old.
  const statusAge = charger.lastStatusAtIso
    ? Date.now() - new Date(charger.lastStatusAtIso).getTime()
    : Number.POSITIVE_INFINITY;
  const isStale = statusAge > STALE_DIM_MS && status !== "Offline";

  const IconComponent = getDeviceIcon("charger", charger.formFactor);

  const postOperation = async (
    operation: string,
    params: Record<string, unknown>,
  ) => {
    onAction?.(operation, params);
    try {
      const res = await fetch("/api/admin/charger/operation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: charger.chargeBoxId,
          operation,
          params,
        }),
      });
      if (!res.ok) {
        console.error("Charger operation failed", await res.text());
      }
    } catch (err) {
      console.error("Charger operation error", err);
    }
  };

  const handleStop = async () => {
    if (!activeSession || pendingStop) return;
    setPendingStop(true);
    try {
      await postOperation("RemoteStopTransaction", {
        transactionId: activeSession.transactionId,
      });
    } finally {
      // Keep optimistic "stopping" state for a few seconds; Phase E1 wires
      // the full undo/retry flow. For now we just release the button after
      // 5s so the user can retry if nothing happens.
      setTimeout(() => setPendingStop(false), 5000);
    }
  };

  const handleRefresh = async () => {
    const now = Date.now();
    if (refreshing || now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
    setRefreshing(true);
    setLastRefreshAt(now);
    try {
      await postOperation("TriggerMessage", {
        triggerMessage: "StatusNotification",
      });
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  };

  const handleUnlockConfirmed = async () => {
    setUnlockConfirmOpen(false);
    await postOperation("UnlockConnector", { connectorId: 1 });
  };

  const displayName = charger.friendlyName?.trim() || charger.chargeBoxId;
  const showChargeBoxIdChip = !!charger.friendlyName?.trim() &&
    charger.friendlyName.trim() !== charger.chargeBoxId;
  const isCharging = status === "Charging";

  return (
    <>
      <div class="relative">
        <div class="relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground">
          <div class="flex w-full flex-col gap-3 p-4">
            {/* Header row: charger icon (status-colored halo) + title, vertically centered */}
            <div class="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    class={cn(
                      "shrink-0 transition-opacity",
                      isStale && "opacity-60",
                    )}
                    aria-label={status === "Offline" || isStale
                      ? `${status} — last seen ${
                        formatRelative(charger.lastStatusAtIso)
                      }`
                      : status}
                  >
                    <span
                      role="status"
                      aria-label={`Status: ${status}`}
                    >
                      <IconComponent
                        size="md"
                        haloColor={STATUS_HALO[status]}
                      />
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div class="flex flex-col gap-0.5">
                    <span class="font-medium">{status}</span>
                    {(status === "Offline" || isStale) && (
                      <span class="opacity-80">
                        Last seen {formatRelative(charger.lastStatusAtIso)}
                      </span>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
              <a
                href={`/chargers/${charger.chargeBoxId}`}
                class="flex min-w-0 flex-1 items-baseline gap-2 hover:underline"
              >
                <span class="truncate text-xl font-semibold tracking-tight">
                  {displayName}
                </span>
                {showChargeBoxIdChip
                  ? (
                    <span class="shrink-0 font-mono text-xs text-muted-foreground">
                      {charger.chargeBoxId}
                    </span>
                  )
                  : null}
              </a>
              {liveKw.value !== null && (
                <span
                  class={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  )}
                  aria-label={`Live ${liveKw.value.toFixed(1)} kilowatts`}
                >
                  <Zap class="size-3" aria-hidden="true" />
                  <span class="tabular-nums">
                    {liveKw.value.toFixed(1)} kW
                  </span>
                </span>
              )}
            </div>

            {/* Divider */}
            <div class="h-px w-full bg-border/60" />

            {/* Metrics row */}
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {activeSession
                ? (
                  <>
                    <div>
                      <span class="text-muted-foreground">Current:</span>{" "}
                      <span class="font-medium">
                        {activeSession.currentKw !== null
                          ? `${activeSession.currentKw.toFixed(1)} kW`
                          : "—"}
                        {" · "}
                        {formatSessionDuration(activeSession.startTimestampIso)}
                      </span>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Session:</span>{" "}
                      <span class="font-medium">
                        {activeSession.sessionKwh !== null
                          ? `${activeSession.sessionKwh.toFixed(1)} kWh`
                          : "—"}
                      </span>
                    </div>
                  </>
                )
                : (
                  <div class="col-span-2 text-muted-foreground">
                    No active session
                  </div>
                )}
              <div class="col-span-2">
                <span class="text-muted-foreground">Uptime:</span>{" "}
                <span class="font-medium">
                  {formatUptime(charger.firstSeenAtIso)}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div class="h-px w-full bg-border/60" />

            {/* Actions */}
            <div class="flex items-center gap-2">
              {isCharging
                ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStop}
                    disabled={pendingStop || !activeSession}
                  >
                    <StopCircle class="size-4" />
                    {pendingStop ? "Stopping…" : "Stop"}
                  </Button>
                )
                : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-label={refreshing
                      ? "Refreshing…"
                      : "Refresh status from StEvE"}
                  >
                    <RefreshCw
                      class={cn("size-4", refreshing && "animate-spin")}
                    />
                    Refresh
                  </Button>
                )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReserveOpen(true)}
              >
                Reserve
              </Button>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  class="ml-auto text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
                  onClick={() => setUnlockConfirmOpen(true)}
                >
                  <Lock class="size-4" />
                  Unlock
                </Button>
              )}
            </div>
          </div>

          {/* Conditional border-beam while charging — genuine live-session indicator, not decoration */}
          {activeSession && (
            <BorderBeam
              size={180}
              duration={8}
              colorFrom="oklch(0.75 0.15 220)"
              colorTo="oklch(0.70 0.18 230)"
            />
          )}
        </div>
      </div>

      {/* Reserve placeholder modal (Phase E4 wires full flow) */}
      {reserveOpen && (
        <Dialog open={reserveOpen} onOpenChange={setReserveOpen}>
          <DialogContent onClose={() => setReserveOpen(false)}>
            <DialogHeader>
              <DialogTitle>Reserve {displayName}</DialogTitle>
              <DialogDescription>
                Reservation flow lands in Phase E4 — this modal is a
                placeholder.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReserveOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Unlock confirm modal */}
      {unlockConfirmOpen && (
        <Dialog
          open={unlockConfirmOpen}
          onOpenChange={setUnlockConfirmOpen}
        >
          <DialogContent onClose={() => setUnlockConfirmOpen(false)}>
            <DialogHeader>
              <DialogTitle>Unlock connector?</DialogTitle>
              <DialogDescription>
                Guest will be able to unplug. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setUnlockConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleUnlockConfirmed}>
                Unlock
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
