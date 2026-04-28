/**
 * DeviceCard — single card surface for both OCPP chargers and iOS/macOS NFC
 * scanners.
 *
 * Both branches share the same three-section body skeleton (pills row →
 * primary status line → 2-col metric grid) and the same action-row layout
 * (primary, secondary, admin-destructive on `ml-auto`). The only thing that
 * differs is the *content* of each slot — chargers carry a live kW chip, an
 * active-session description, uptime, refresh/stop/reserve/unlock; scanners
 * carry capability pills, a "last seen / online now" line, owner +
 * registration date, view/rename/force-deregister.
 *
 * Layout:
 *
 *   ┌────────────────────────────────────────────┐
 *   │  [icon]  Display name                kW chip│   header
 *   │          chargeBoxId / model · v…           │
 *   │  ────────────────────────────────────────  │
 *   │  [pill] [pill] [pill]                       │   pills row
 *   │  Primary status line                         │   status line
 *   │  Metric A         Metric B                   │   metric grid
 *   │  ────────────────────────────────────────  │
 *   │  [Primary] [Secondary]          [Destructive]│   actions
 *   └────────────────────────────────────────────┘
 *
 * The icon's halo carries online/offline status; there's no Online/Offline
 * pill in the header.
 *
 * Charger-specific behaviour:
 *   - Live kW chip in the header, driven by `transaction.meter` SSE events.
 *   - BorderBeam decoration only while a session is active.
 *
 * Scanner-specific behaviour:
 *   - Rename + Force-deregister inlined as buttons (no dropdown). Confirms
 *     reuse `ConfirmDialog` and the same API endpoints as the standalone
 *     `DeviceActionsMenu` (which the device detail page still uses).
 */

import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { toast } from "sonner";
import {
  CalendarClock,
  Eye,
  Lock,
  Pencil,
  RefreshCw,
  ShieldOff,
  StopCircle,
  Zap,
} from "lucide-preact";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
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
import { ConfirmDialog } from "@/components/shared/ConfirmDialog.tsx";
import { CapabilityPill } from "@/components/devices/CapabilityPill.tsx";
import { getDeviceIcon } from "@/src/lib/utils/device-icons.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  DEVICE_STATUS_HALO,
  formatRelative,
  formatSessionDuration,
  normalizeDeviceStatus,
  normalizeStatus,
  REFRESH_COOLDOWN_MS,
  STALE_DIM_MS,
  STATUS_HALO,
} from "@/islands/shared/device-visuals.ts";

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
  kind: "phone_nfc" | "tablet_nfc" | "laptop_nfc";
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

export interface DeviceCardProps {
  entry: UnifiedDeviceEntry;
  isAdmin?: boolean;
  /** Charger-only: forwarded to the OCPP operation poster for instrumentation. */
  onAction?: (op: string, params: Record<string, unknown>) => void;
}

// ---- Component -----------------------------------------------------------

export default function DeviceCard(
  { entry, isAdmin = false, onAction }: DeviceCardProps,
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

/** Pill row container — always reserves height so charger and scanner rows
 *  align even when one side has no pills. */
function PillRow({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="flex min-h-6 flex-wrap items-center gap-1.5">{children}</div>
  );
}

/** Generic tone-mapped pill (for charger form-factor + connector status). */
function StatusPill(
  { tone, children, icon }: {
    tone: "slate" | "emerald" | "amber" | "rose" | "cyan";
    children: preact.ComponentChildren;
    icon?: preact.ComponentChildren;
  },
) {
  const toneClasses: Record<typeof tone, string> = {
    slate:
      "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    emerald:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    amber:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  };
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
      )}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}

// ---- Charger -------------------------------------------------------------

const FORM_FACTOR_LABEL: Record<string, string> = {
  wallbox: "Wallbox",
  pulsar: "Pulsar",
  commander: "Commander",
  wall_mount: "Wall mount",
  generic: "Generic",
};

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
  const formFactorLabel = FORM_FACTOR_LABEL[charger.formFactor] ??
    charger.formFactor;

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

  const activityLine = activeSession
    ? `${
      activeSession.currentKw !== null
        ? `${activeSession.currentKw.toFixed(1)} kW`
        : "—"
    } · ${formatSessionDuration(activeSession.startTimestampIso)}${
      activeSession.sessionKwh !== null
        ? ` · ${activeSession.sessionKwh.toFixed(1)} kWh`
        : ""
    }`
    : "idle";

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

        {
          /* Pills row — form factor only. The icon halo + Activity line
            already encode connector status; a redundant status pill made the
            row feel busier than the scanner pills row. */
        }
        <PillRow>
          <StatusPill tone="slate">
            {formatFormFactor(formFactorLabel)}
          </StatusPill>
        </PillRow>

        {/* Primary status line — full-width */}
        <div class="text-xs">
          <span class="text-muted-foreground">Activity:</span>{" "}
          <span class="font-medium">{activityLine}</span>
        </div>

        {/* Metric grid */}
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div class="truncate">
            <span class="text-muted-foreground">First seen:</span>{" "}
            <span class="font-medium">
              {formatRelative(charger.firstSeenAtIso)}
            </span>
          </div>
          <div class="truncate">
            <span class="text-muted-foreground">Updated:</span>{" "}
            <span class="font-medium">
              {formatRelative(charger.lastStatusAtIso) ?? "never"}
            </span>
          </div>
        </div>

        <Divider />

        {/* Actions — same shape as scanner: [primary] [secondary] [admin ml-auto] */}
        <div class="flex items-center gap-2">
          {isCharging
            ? (
              <Button
                size="sm"
                variant="outline"
                class="text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
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
            <CalendarClock class="size-4" />
            Reserve
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              class="ml-auto text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
              onClick={() => setUnlockConfirmOpen(true)}
            >
              <Lock class="size-4" />
              Unlock
            </Button>
          )}
        </div>
      </CardShell>

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

function formatFormFactor(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

// ---- Scanner -------------------------------------------------------------

function ScannerBody(
  { device, isAdmin }: { device: DeviceCardDto; isAdmin: boolean },
) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(device.label);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deregisterLoading, setDeregisterLoading] = useState(false);

  const status = normalizeDeviceStatus(device.lastSeenAtIso, device.isOnline);
  const Icon = getDeviceIcon(device.kind);
  const halo = DEVICE_STATUS_HALO[status];
  const isOffline = status === "Offline";
  const subtitle = device.model ?? device.platform ?? "Unknown model";

  const submitRename = async (e?: Event) => {
    e?.preventDefault();
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      setRenameError("Label can't be empty.");
      return;
    }
    if (trimmed.length > 80) {
      setRenameError("Max 80 characters.");
      return;
    }
    setRenameError(null);
    setRenameLoading(true);
    try {
      const res = await fetch(`/api/admin/devices/${device.deviceId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text();
        setRenameError(`Rename failed (${res.status}): ${text}`);
        return;
      }
      toast.success(`Renamed to "${trimmed}"`);
      setRenameOpen(false);
      globalThis.location.reload();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenameLoading(false);
    }
  };

  const submitDeregister = async () => {
    setDeregisterLoading(true);
    try {
      const res = await fetch(
        `/api/admin/devices/${device.deviceId}/deregister`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "admin_ui" }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        toast.error(`Deregister failed (${res.status}): ${text}`);
        return;
      }
      toast.success(`Device "${device.label}" deregistered`);
      setConfirmOpen(false);
      globalThis.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeregisterLoading(false);
    }
  };

  const kindLabel = device.kind === "phone_nfc"
    ? "Phone"
    : device.kind === "tablet_nfc"
    ? "Tablet"
    : "Laptop";
  const activityLine = device.isOnline
    ? "Online now"
    : device.lastSeenAtIso
    ? `Last seen ${formatRelative(device.lastSeenAtIso)}`
    : "never seen";

  return (
    <>
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

        {/* Pills row — kind + capabilities */}
        <PillRow>
          <StatusPill tone="slate">{kindLabel}</StatusPill>
          {device.capabilities.map((c) => (
            <CapabilityPill key={c} capability={c} />
          ))}
        </PillRow>

        {/* Primary status line — full-width */}
        <div class="text-xs">
          <span class="text-muted-foreground">Activity:</span>{" "}
          <span
            class={cn(
              "font-medium",
              device.isOnline && "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {activityLine}
          </span>
        </div>

        {/* Metric grid */}
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div class="truncate">
            <span class="text-muted-foreground">Registered:</span>{" "}
            <span class="font-medium">
              {formatRelative(device.registeredAtIso)}
            </span>
          </div>
          <div class="truncate">
            <span class="text-muted-foreground">Updated:</span>{" "}
            <span class="font-medium">
              {formatRelative(device.lastSeenAtIso) ?? "never"}
            </span>
          </div>
        </div>

        <Divider />

        {/* Actions — same shape as charger: [primary] [secondary] [admin ml-auto] */}
        <div class="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`/admin/devices/${device.deviceId}`}>
              <Eye class="size-4" />
              View
            </a>
          </Button>
          {isAdmin
            ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRenameValue(device.label);
                    setRenameError(null);
                    setRenameOpen(true);
                  }}
                >
                  <Pencil class="size-4" />
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="ml-auto text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
                  onClick={() => setConfirmOpen(true)}
                >
                  <ShieldOff class="size-4" />
                  Deregister
                </Button>
              </>
            )
            : (
              // Same-width spacer keeps non-admin scanner cards aligned with
              // the admin variant + the charger card.
              <span class="ml-auto" aria-hidden="true" />
            )}
        </div>
      </CardShell>

      {renameOpen && (
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent onClose={() => setRenameOpen(false)}>
            <DialogHeader>
              <DialogTitle>Rename device</DialogTitle>
              <DialogDescription>
                Pick a label that admins will see in lists. Visible to the
                device owner too.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitRename} class="flex flex-col gap-2">
              <Input
                type="text"
                value={renameValue}
                onInput={(e) =>
                  setRenameValue((e.currentTarget as HTMLInputElement).value)}
                maxLength={80}
                autoFocus
                disabled={renameLoading}
              />
              {renameError && (
                <p class="text-sm text-destructive">{renameError}</p>
              )}
              <DialogFooter className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRenameOpen(false)}
                  disabled={renameLoading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={renameLoading}>
                  {renameLoading ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Force deregister device?"
        description={
          <>
            This soft-deletes <strong>{device.label}</strong>{" "}
            and revokes every active bearer token. The owner will be signed out
            on next request and the {device.kind === "phone_nfc"
              ? "phone"
              : device.kind === "tablet_nfc"
              ? "tablet"
              : "laptop"}{" "}
            must re-register. This cannot be undone via the admin UI.
          </>
        }
        confirmLabel={deregisterLoading ? "Deregistering…" : "Force deregister"}
        cancelLabel="Cancel"
        variant="destructive"
        icon={<ShieldOff class="size-4 text-rose-500" aria-hidden="true" />}
        typeToConfirmPhrase={device.label}
        onConfirm={submitDeregister}
        isLoading={deregisterLoading}
      />
    </>
  );
}
