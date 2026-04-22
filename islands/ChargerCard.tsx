import { useState } from "preact/hooks";
import { Lock, RefreshCw, StopCircle } from "lucide-preact";
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
import {
  chargerFormFactorIcons,
  GenericChargerIcon,
} from "@/components/brand/chargers/index.ts";
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
} from "./shared/charger-visuals.ts";

export default function ChargerCard(
  { charger, activeSession, isAdmin = false, onAction }: ChargerCardProps,
) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(0);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
  const [pendingStop, setPendingStop] = useState(false);

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

  const IconComponent = chargerFormFactorIcons[
    charger.formFactor as keyof typeof chargerFormFactorIcons
  ] ?? GenericChargerIcon;

  const postOperation = async (
    operation: string,
    params: Record<string, unknown>,
  ) => {
    onAction?.(operation, params);
    try {
      const res = await fetch("/api/charger/operation", {
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

  const displayName = charger.friendlyName ?? charger.chargeBoxId;
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
                    aria-label={`${status} — last seen ${
                      formatRelative(charger.lastStatusAtIso)
                    }`}
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
                    <span class="opacity-80">
                      Last seen {formatRelative(charger.lastStatusAtIso)}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
              <a
                href={`/chargers/${charger.chargeBoxId}`}
                class="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight hover:underline"
              >
                {displayName}
              </a>
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
