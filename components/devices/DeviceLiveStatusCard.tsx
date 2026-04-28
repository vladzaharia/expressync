/**
 * DeviceLiveStatusCard — comprehensive remote-diagnostics readout for
 * the device detail page. Mirrors the spirit of `ChargerLiveStatusCard`
 * (big status pill at the top, then progressively detailed rows) but
 * with the field set widened to cover everything the iOS app sends in
 * the `me/state/sync` diagnostics payload.
 *
 * Layout, top-down:
 *   1. Status hero — Online/Stale/Offline pill + last-sync timestamp.
 *   2. Permissions — one row per OS permission. Notifications & APNs
 *      collapse into a single row with three distinct sub-states:
 *      `authorized + APNs token`, `authorized + NO APNs token` (the
 *      "missing key" warning state), `denied/notDetermined`.
 *   3. Connectivity — reconnects, pending uploads, network interface.
 *   4. Health — battery, thermal, low-power, disk free.
 *   5. Identity — model, OS, app build, platform, locale, timezone,
 *      APNs environment.
 *
 * All field sources live in `devices.last_status` JSONB, populated by
 * the iOS sync. Missing fields render as `—` so partial uplift from an
 * older client still produces a coherent readout.
 */

import {
  AlertCircle,
  Bell,
  BellOff,
  Radio,
  ScanLine,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { formatRelative } from "@/islands/shared/device-visuals.ts";

type UiOnlineState = "online" | "stale" | "offline";

type PushPermission =
  | "authorized"
  | "denied"
  | "notDetermined"
  | "provisional"
  | "ephemeral";

type PermissionState =
  | "authorized"
  | "denied"
  | "notDetermined"
  | "restricted"
  | "unavailable";

type BackgroundRefreshState = "available" | "denied" | "restricted";
type BatteryState = "unknown" | "unplugged" | "charging" | "full";
type ThermalState = "nominal" | "fair" | "serious" | "critical";

export interface DeviceLiveStatus {
  isOnline: boolean;
  lastSeenAtIso: string | null;
  reconnectCount: number;
  pendingUploads: number;
  pushPermission: PushPermission | null;
  pushTokenLast8: string | null;
  apnsEnvironment: string | null;
  nfcAvailable: boolean | null;
  nfcPermission: PermissionState | null;
  backgroundRefreshStatus: BackgroundRefreshState | null;
  appVersion: string | null;
  osVersion: string | null;
  model: string | null;
  localizedModel: string | null;
  platform: string | null;
  locale: string | null;
  timezone: string | null;
  batteryLevel: number | null;
  batteryState: BatteryState | null;
  lowPowerMode: boolean | null;
  thermalState: ThermalState | null;
  networkInterface: string | null;
  networkIsConstrained: boolean | null;
  networkIsExpensive: boolean | null;
  diskFreeBytes: number | null;
  lastErrorMessage: string | null;
}

interface Props {
  status: DeviceLiveStatus;
  class?: string;
}

const STALE_AFTER_MS = 90 * 1000;
const OFFLINE_AFTER_MS = 15 * 60 * 1000;

function deriveUiState(s: DeviceLiveStatus): UiOnlineState {
  if (s.isOnline) return "online";
  if (!s.lastSeenAtIso) return "offline";
  const ms = Date.parse(s.lastSeenAtIso);
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

function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatPercent(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

interface PermissionRowProps {
  icon: typeof Bell;
  label: string;
  status: "good" | "warn" | "bad" | "neutral";
  value: string;
  detail?: string;
}

function permissionTone(s: PermissionRowProps["status"]): string {
  switch (s) {
    case "good":
      return "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
    case "warn":
      return "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300";
    case "bad":
      return "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300";
    case "neutral":
      return "border-slate-500/20 bg-slate-500/5 text-slate-700 dark:text-slate-300";
  }
}

function PermissionRow({
  icon: Icon,
  label,
  status,
  value,
  detail,
}: PermissionRowProps) {
  return (
    <div
      class={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 text-sm",
        permissionTone(status),
      )}
    >
      <Icon aria-hidden class="size-4 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">{label}</div>
        {detail && <div class="text-xs opacity-80 truncate">{detail}</div>}
      </div>
      <div class="text-xs font-medium whitespace-nowrap">{value}</div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between gap-2 text-sm">
      <dt class="text-muted-foreground">{label}</dt>
      <dd class="font-mono text-xs truncate text-right">{value}</dd>
    </div>
  );
}

/**
 * Combine UN authorization + APNs token presence into a single row
 * with three distinct sub-states. Per user direction: notifications &
 * push are one OS-level permission; the missing-APNs-key sub-state is
 * its own status because only the device can recover from it (the
 * server can't push without a token).
 */
function notificationsRow(s: DeviceLiveStatus): PermissionRowProps {
  if (s.pushPermission === null) {
    return {
      icon: BellOff,
      label: "Notifications",
      status: "neutral",
      value: "Unknown",
    };
  }
  if (s.pushPermission === "denied") {
    return {
      icon: BellOff,
      label: "Notifications",
      status: "bad",
      value: "Denied",
      detail: "User declined push permission. Falls back to SSE.",
    };
  }
  if (s.pushPermission === "notDetermined") {
    return {
      icon: BellOff,
      label: "Notifications",
      status: "neutral",
      value: "Not asked",
      detail: "App hasn't prompted for push permission yet.",
    };
  }
  if (s.pushTokenLast8 === null) {
    return {
      icon: Bell,
      label: "Notifications",
      status: "warn",
      value: "Granted, no APNs key",
      detail:
        "Permission granted but the APNs token never reached the server. Push will silently fail until the device re-registers.",
    };
  }
  return {
    icon: Bell,
    label: "Notifications",
    status: "good",
    value: `Active ··${s.pushTokenLast8.slice(-4)}`,
    detail: s.apnsEnvironment && s.apnsEnvironment !== "production"
      ? `APNs environment: ${s.apnsEnvironment}`
      : undefined,
  };
}

function nfcRow(s: DeviceLiveStatus): PermissionRowProps {
  if (s.nfcAvailable === false) {
    return {
      icon: ScanLine,
      label: "NFC reader",
      status: "neutral",
      value: "Unavailable",
      detail: "This device hardware doesn't support NFC reading.",
    };
  }
  switch (s.nfcPermission) {
    case "authorized":
      return {
        icon: ScanLine,
        label: "NFC reader",
        status: "good",
        value: "Available",
      };
    case "denied":
      return {
        icon: ScanLine,
        label: "NFC reader",
        status: "bad",
        value: "Denied",
      };
    case "restricted":
      return {
        icon: ScanLine,
        label: "NFC reader",
        status: "warn",
        value: "Restricted",
      };
    case "unavailable":
      return {
        icon: ScanLine,
        label: "NFC reader",
        status: "neutral",
        value: "Unavailable",
      };
    default:
      return {
        icon: ScanLine,
        label: "NFC reader",
        status: "neutral",
        value: s.nfcAvailable ? "Available" : "Unknown",
      };
  }
}

function backgroundRefreshRow(s: DeviceLiveStatus): PermissionRowProps {
  switch (s.backgroundRefreshStatus) {
    case "available":
      return {
        icon: Radio,
        label: "Background refresh",
        status: "good",
        value: "Available",
      };
    case "denied":
      return {
        icon: Radio,
        label: "Background refresh",
        status: "warn",
        value: "Denied",
        detail: "Sync only runs when the app is in the foreground.",
      };
    case "restricted":
      return {
        icon: Radio,
        label: "Background refresh",
        status: "warn",
        value: "Restricted",
      };
    default:
      return {
        icon: Radio,
        label: "Background refresh",
        status: "neutral",
        value: "Unknown",
      };
  }
}

export function DeviceLiveStatusCard(
  { status: s, class: className }: Props,
) {
  const ui = deriveUiState(s);
  const isOffline = ui === "offline";
  const isStale = ui === "stale";

  const notifications = notificationsRow(s);
  const nfc = nfcRow(s);
  const bgRefresh = backgroundRefreshRow(s);

  const networkInterfaceLabel = (() => {
    if (!s.networkInterface) return "—";
    const map: Record<string, string> = {
      wifi: "Wi-Fi",
      cellular: "Cellular",
      wired: "Ethernet",
      loopback: "Loopback",
    };
    return map[s.networkInterface] ?? s.networkInterface;
  })();

  return (
    <div
      class={cn(
        "relative flex h-full flex-col gap-5 overflow-hidden rounded-xl border bg-card p-5",
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
      </div>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Permissions
        </h3>
        <div class="flex flex-col gap-2">
          <PermissionRow {...notifications} />
          <PermissionRow {...nfc} />
          <PermissionRow {...bgRefresh} />
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Connectivity
        </h3>
        <dl class="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-6">
          <KeyValue
            label="Last sync"
            value={s.lastSeenAtIso
              ? new Date(s.lastSeenAtIso).toLocaleString()
              : "—"}
          />
          <KeyValue label="Reconnects" value={String(s.reconnectCount)} />
          <KeyValue
            label="Pending uploads"
            value={String(s.pendingUploads)}
          />
          <KeyValue label="Network" value={networkInterfaceLabel} />
          {s.networkIsConstrained !== null && (
            <KeyValue
              label="Constrained"
              value={s.networkIsConstrained ? "Yes" : "No"}
            />
          )}
          {s.networkIsExpensive !== null && (
            <KeyValue
              label="Expensive"
              value={s.networkIsExpensive ? "Yes" : "No"}
            />
          )}
        </dl>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Health
        </h3>
        <dl class="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-6">
          <KeyValue
            label="Battery"
            value={`${formatPercent(s.batteryLevel)}${
              s.batteryState && s.batteryState !== "unknown"
                ? ` · ${s.batteryState}`
                : ""
            }`}
          />
          <KeyValue
            label="Low-power mode"
            value={s.lowPowerMode === null
              ? "—"
              : s.lowPowerMode
              ? "On"
              : "Off"}
          />
          <KeyValue
            label="Thermal state"
            value={s.thermalState ?? "—"}
          />
          <KeyValue label="Disk free" value={formatBytes(s.diskFreeBytes)} />
        </dl>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identity
        </h3>
        <dl class="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-6">
          <KeyValue
            label="Model"
            value={s.localizedModel ?? s.model ?? "—"}
          />
          <KeyValue
            label="Platform"
            value={`${s.platform ?? "—"}${
              s.osVersion ? ` ${s.osVersion}` : ""
            }`}
          />
          <KeyValue label="App version" value={s.appVersion ?? "—"} />
          <KeyValue
            label="APNs env"
            value={s.apnsEnvironment ?? "—"}
          />
          <KeyValue label="Locale" value={s.locale ?? "—"} />
          <KeyValue label="Timezone" value={s.timezone ?? "—"} />
        </dl>
      </section>
    </div>
  );
}
