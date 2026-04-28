/**
 * DeviceLiveStatusCard — hero readout for the App Configuration tab.
 *
 * Mirrors `ChargerLiveStatusCard` in spirit: a big status pill at the
 * top, a timestamped "last sync" line, a row of permission pills, and a
 * compact metric grid for the diagnostic counters (reconnects, pending
 * uploads, app/OS versions). Server-rendered — chargers get a refresh
 * button because they can be told to TriggerMessage; app devices can't
 * be poked from the server, so the card is read-only and refreshes on
 * page reload (or via SSE-driven re-render once the live UI lands).
 *
 * Tone vocabulary intentionally matches the charger card so the two
 * detail pages read as a family:
 *   - online        → emerald
 *   - stale (≤15m)  → amber
 *   - offline       → muted / dashed border
 */

import {
  AlertCircle,
  AppWindow,
  Bell,
  BellOff,
  Layers,
  Radio,
  ScanLine,
  Upload,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { formatRelative } from "@/islands/shared/device-visuals.ts";

type UiOnlineState = "online" | "stale" | "offline";

export interface DeviceLiveStatus {
  isOnline: boolean;
  lastSeenAtIso: string | null;
  reconnectCount: number;
  pendingUploads: number;
  pushPermission: boolean | null;
  nfcPermission: boolean | null;
  appVersion: string | null;
  osVersion: string | null;
  model: string | null;
  platform: string | null;
  pushTokenLast8: string | null;
  apnsEnvironment: string | null;
  lastErrorMessage: string | null;
}

interface Props {
  status: DeviceLiveStatus;
  class?: string;
}

const STALE_AFTER_MS = 90 * 1000;
const OFFLINE_AFTER_MS = 15 * 60 * 1000;

function deriveUiState(status: DeviceLiveStatus): UiOnlineState {
  if (status.isOnline) return "online";
  if (!status.lastSeenAtIso) return "offline";
  const ms = Date.parse(status.lastSeenAtIso);
  if (!Number.isFinite(ms)) return "offline";
  const age = Date.now() - ms;
  if (age <= STALE_AFTER_MS) return "online";
  if (age <= OFFLINE_AFTER_MS) return "stale";
  return "offline";
}

function statusLabel(s: UiOnlineState): string {
  switch (s) {
    case "online":
      return "Online";
    case "stale":
      return "Stale";
    case "offline":
      return "Offline";
  }
}

function statusTone(s: UiOnlineState): string {
  switch (s) {
    case "online":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
    case "stale":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40";
    case "offline":
      return "bg-muted text-muted-foreground border-muted";
  }
}

function statusDot(s: UiOnlineState): string {
  switch (s) {
    case "online":
      return "rgb(16 185 129)";
    case "stale":
      return "rgb(245 158 11)";
    case "offline":
      return "rgb(148 163 184)";
  }
}

function permissionTone(v: boolean | null): string {
  if (v === null) {
    return "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300";
  }
  return v
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function permissionLabel(name: string, v: boolean | null): string {
  if (v === null) return `${name}: unknown`;
  return `${name}: ${v ? "granted" : "denied"}`;
}

function PermissionPill(
  { name, value, icon: Icon }: {
    name: string;
    value: boolean | null;
    icon: typeof Bell;
  },
) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        permissionTone(value),
      )}
    >
      <Icon aria-hidden class="size-3" />
      {permissionLabel(name, value)}
    </span>
  );
}

export function DeviceLiveStatusCard(
  { status: s, class: className }: Props,
) {
  const ui = deriveUiState(s);
  const isOffline = ui === "offline";
  const isStale = ui === "stale";

  return (
    <div
      class={cn(
        "relative flex h-full flex-col gap-4 overflow-hidden rounded-xl border bg-card p-5",
        isStale && "opacity-90",
        isOffline && "border-dashed",
        className,
      )}
    >
      {s.lastErrorMessage && (
        <div
          role="alert"
          class="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertCircle class="size-4 shrink-0" />
          <span>
            <strong class="font-medium">Last error:</strong>{" "}
            {s.lastErrorMessage}
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
              statusTone(ui),
            )}
          >
            <span
              aria-hidden="true"
              class="inline-block size-2.5 rounded-full"
              style={{ background: statusDot(ui) }}
            />
            {statusLabel(ui)}
          </div>
          <div class="text-xs text-muted-foreground">
            Last sync {formatRelative(s.lastSeenAtIso)}
          </div>
        </div>

        <div class="flex flex-col items-end gap-1">
          <div class="flex flex-wrap items-center justify-end gap-1.5">
            <PermissionPill
              name="Push"
              value={s.pushPermission}
              icon={s.pushPermission ? Bell : BellOff}
            />
            <PermissionPill
              name="NFC"
              value={s.nfcPermission}
              icon={ScanLine}
            />
          </div>
          {s.pushTokenLast8 && (
            <span class="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
              <Radio aria-hidden class="size-3" />
              APNs ··{s.pushTokenLast8.slice(-4)}
              {s.apnsEnvironment && s.apnsEnvironment !== "production"
                ? ` (${s.apnsEnvironment})`
                : ""}
            </span>
          )}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          icon={Radio}
          label="Reconnects"
          value={String(s.reconnectCount)}
          accent="teal"
        />
        <MetricTile
          icon={Upload}
          label="Pending uploads"
          value={String(s.pendingUploads)}
          accent="teal"
        />
        <MetricTile
          icon={AppWindow}
          label="App version"
          value={s.appVersion ?? "—"}
          accent="teal"
        />
        <MetricTile
          icon={Layers}
          label="OS version"
          value={s.osVersion ?? "—"}
          accent="teal"
        />
      </div>
    </div>
  );
}
