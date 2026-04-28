/**
 * UnifiedDeviceCard — single card surface for both OCPP chargers and
 * iOS/macOS NFC scanners.
 *
 * Layout is identical across the two types so the grid reads cleanly:
 *
 *   ┌────────────────────────────────────────────┐
 *   │  [icon]  Display name                kW chip│   header row
 *   │          chargeBoxId / model · v…           │
 *   │  ────────────────────────────────────────  │
 *   │  capability pills (scanner only)            │   body
 *   │  metric grid:   col-1            col-2      │
 *   │  ────────────────────────────────────────  │
 *   │  [Action]  [Action]              [Admin]    │   actions
 *   └────────────────────────────────────────────┘
 *
 * The icon's halo carries status (offline = rose, charging = emerald, etc.)
 * — there's no explicit Online/Offline pill; the icon already says it.
 *
 * Charger-specific behaviour:
 *   - Live kW chip in the header, driven by `transaction.meter` SSE events.
 *   - Body shows active session metrics (current kW, session kWh, duration)
 *     when a session is in flight; otherwise "No active session" + uptime.
 *   - Actions: Stop (when charging) or Refresh status, Reserve, Unlock (admin).
 *   - BorderBeam decoration only while a session is active.
 *
 * Scanner-specific behaviour:
 *   - Capability pills row.
 *   - Body shows "Online now" / "Last seen" + Owner.
 *   - Actions: View, then DeviceActionsMenu (admin).
 */

import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ExternalLink, Lock, RefreshCw, StopCircle, Zap } from "lucide-preact";
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
import { CapabilityPill } from "@/components/devices/CapabilityPill.tsx";
import { getDeviceIcon } from "@/src/lib/utils/device-icons.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  DEVICE_STATUS_HALO,
  formatRelative,
  formatSessionDuration,
  formatUptime,
  normalizeDeviceStatus,
  normalizeStatus,
  REFRESH_COOLDOWN_MS,
  STALE_DIM_MS,
  STATUS_HALO,
} from "@/islands/shared/device-visuals.ts";
import DeviceActionsMenu from "@/islands/devices/DeviceActionsMenu.tsx";

// ---- DTOs ----------------------------------------------------------------

export interface ChargerCardDto {
  chargeBoxId: string;
  chargeBoxPk: number | null;
  friendlyName: string | null;
  formFactor: string;
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

export interface DeviceCardDto {
  deviceId: string;
  kind: "phone_nfc" | "laptop_nfc";
  label: string;
  platform: string | null;
  model: string | null;
  appVersion: string | null;
  ownerUserId: string | null;
  capabilities: string[];
  lastSeenAtIso: string | null;
  isOnline: boolean;
  registeredAtIso: string;
}

export type UnifiedDeviceEntry =
  | { type: "charger"; data: ChargerCardDto; activeSession?: ActiveSessionDto }
  | { type: "scanner"; data: DeviceCardDto };

export interface UnifiedDeviceCardProps {
  entry: UnifiedDeviceEntry;
  isAdmin?: boolean;
  /** Charger-only: forwarded to the OCPP operation poster for instrumentation. */
  onAction?: (op: string, params: Record<string, unknown>) => void;
}

// ---- Component -----------------------------------------------------------

export default function UnifiedDeviceCard(
  { entry, isAdmin = false, onAction }: UnifiedDeviceCardProps,
) {
  return entry.type === "charger"
    ? (
      <ChargerBody
        charger={entry.data}
        activeSession={entry.activeSession}
        isAdmin={isAdmin}
        onAction={onAction}
      />
    )
    : <ScannerBody device={entry.data} isAdmin={isAdmin} />;
}

// ---- Shared chrome -------------------------------------------------------

function CardShell(
  { children, beam }: {
    children: preact.ComponentChildren;
    beam?: boolean;
  },
) {
  return (
    <div class="relative">
      <div class="relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground">
        <div class="flex w-full flex-col gap-3 p-4">{children}</div>
        {beam && (
          <BorderBeam
            size={180}
            duration={8}
            colorFrom="oklch(0.75 0.15 220)"
            colorTo="oklch(0.70 0.18 230)"
          />
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div class="h-px w-full bg-border/60" />;
}

// ---- Charger -------------------------------------------------------------

function ChargerBody(
  { charger, activeSession, isAdmin, onAction }: {
    charger: ChargerCardDto;
    activeSession?: ActiveSessionDto;
    isAdmin: boolean;
    onAction?: (op: string, params: Record<string, unknown>) => void;
  },
) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(0);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
  const [pendingStop, setPendingStop] = useState(false);

  // Live kW chip — `transaction.meter` SSE events filtered by chargeBoxId.
  const liveKw = useSignal<number | null>(null);
  useEffect(() => {
    const perConnector = new Map<string, { kw: number; lastSeen: number }>();
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
  const statusAge = charger.lastStatusAtIso
    ? Date.now() - new Date(charger.lastStatusAtIso).getTime()
    : Number.POSITIVE_INFINITY;
  const isStale = statusAge > STALE_DIM_MS && status !== "Offline";
  const Icon = getDeviceIcon("charger", charger.formFactor);

  const displayName = charger.friendlyName?.trim() || charger.chargeBoxId;
  const showChargeBoxIdSubtitle = !!charger.friendlyName?.trim() &&
    charger.friendlyName.trim() !== charger.chargeBoxId;
  const isCharging = status === "Charging";

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

  return (
    <>
      <CardShell beam={Boolean(activeSession)}>
        {/* Header row */}
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
                <Icon size="md" haloColor={STATUS_HALO[status]} />
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
            class="flex min-w-0 flex-1 flex-col hover:underline"
          >
            <span class="truncate text-base font-semibold tracking-tight">
              {displayName}
            </span>
            {showChargeBoxIdSubtitle
              ? (
                <span class="truncate font-mono text-xs text-muted-foreground">
                  {charger.chargeBoxId}
                </span>
              )
              : null}
          </a>
          {liveKw.value !== null && (
            <span
              class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
              aria-label={`Live ${liveKw.value.toFixed(1)} kilowatts`}
            >
              <Zap class="size-3" aria-hidden="true" />
              <span class="tabular-nums">
                {liveKw.value.toFixed(1)} kW
              </span>
            </span>
          )}
        </div>

        <Divider />

        {/* Metrics */}
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

        <Divider />

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
      </CardShell>

      {/* Reserve placeholder modal */}
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
        <Dialog open={unlockConfirmOpen} onOpenChange={setUnlockConfirmOpen}>
          <DialogContent
            onClose={() =>
              setUnlockConfirmOpen(false)}
          >
            <DialogHeader>
              <DialogTitle>Unlock connector?</DialogTitle>
              <DialogDescription>
                Guest will be able to unplug. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  setUnlockConfirmOpen(false)}
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

// ---- Scanner -------------------------------------------------------------

function ScannerBody(
  { device, isAdmin }: { device: DeviceCardDto; isAdmin: boolean },
) {
  const status = normalizeDeviceStatus(device.lastSeenAtIso, device.isOnline);
  const Icon = getDeviceIcon(device.kind);
  const halo = DEVICE_STATUS_HALO[status];
  const isOffline = status === "Offline";
  const subtitle = device.model ?? device.platform ?? "Unknown model";

  return (
    <CardShell>
      {/* Header row */}
      <div class="flex items-center gap-3">
        <span
          class={cn("shrink-0 transition-opacity", isOffline && "opacity-60")}
          role="status"
          aria-label={`Status: ${status}`}
        >
          <Icon size="md" haloColor={halo} />
        </span>
        <a
          href={`/admin/devices/${device.deviceId}`}
          class="flex min-w-0 flex-1 flex-col hover:underline"
        >
          <span class="truncate text-base font-semibold tracking-tight">
            {device.label}
          </span>
          <span class="truncate text-xs text-muted-foreground">
            {subtitle}
            {device.appVersion ? ` · v${device.appVersion}` : ""}
          </span>
        </a>
      </div>

      <Divider />

      {device.capabilities.length > 0 && (
        <div class="flex flex-wrap gap-1.5">
          {device.capabilities.map((c) => (
            <CapabilityPill key={c} capability={c} />
          ))}
        </div>
      )}

      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div>
          {device.isOnline
            ? (
              <>
                <span class="text-muted-foreground">Status:</span>{" "}
                <span class="font-medium text-emerald-600 dark:text-emerald-400">
                  Online now
                </span>
              </>
            )
            : (
              <>
                <span class="text-muted-foreground">Last seen:</span>{" "}
                <span class="font-medium">
                  {formatRelative(device.lastSeenAtIso)}
                </span>
              </>
            )}
        </div>
        <div class="truncate">
          <span class="text-muted-foreground">Owner:</span> {device.ownerUserId
            ? (
              <a
                href={`/admin/users/${device.ownerUserId}`}
                class="inline-flex items-center gap-0.5 font-medium hover:underline"
                title={device.ownerUserId}
              >
                <span class="truncate max-w-[10ch]">
                  {device.ownerUserId.slice(0, 8)}…
                </span>
                <ExternalLink class="size-3 opacity-60" aria-hidden="true" />
              </a>
            )
            : <span class="font-medium">—</span>}
        </div>
      </div>

      <Divider />

      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={`/admin/devices/${device.deviceId}`}>View</a>
        </Button>
        {isAdmin && (
          <div class="ml-auto">
            <DeviceActionsMenu
              deviceId={device.deviceId}
              label={device.label}
              kind={device.kind}
              compact
            />
          </div>
        )}
      </div>
    </CardShell>
  );
}
