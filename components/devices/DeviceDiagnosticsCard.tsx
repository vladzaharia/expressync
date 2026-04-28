/**
 * DeviceDiagnosticsCard — read-only diagnostics readout for the App
 * Configuration tab on `/admin/devices/:id`.
 *
 * Reads the projection of `devices.last_status` JSONB returned by
 * `GET /api/admin/devices/{deviceId}/configuration` and surfaces it as
 * a metric grid: push permission, NFC permission, last seen, reconnect
 * count, pending uploads, app version, OS version, model.
 *
 * Server-rendered; no interactive affordances. Use inside a SectionCard
 * — the card chrome lives at the page level so the same diagnostics
 * shape can be reused on a charger-side configuration tab if that ever
 * lands.
 */

import {
  AppWindow,
  Bell,
  Layers,
  Plug,
  Radio,
  ScanLine,
  Smartphone,
  Upload,
} from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface DeviceDiagnostics {
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

interface DeviceDiagnosticsCardProps {
  diagnostics: DeviceDiagnostics;
  class?: string;
}

function permissionLabel(v: boolean | null): string {
  if (v === null) return "Unknown";
  return v ? "Granted" : "Denied";
}

function permissionTone(v: boolean | null): string {
  if (v === null) {
    return "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300";
  }
  return v
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function PermissionPill(
  { value, icon: Icon }: {
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
      {permissionLabel(value)}
    </span>
  );
}

function formatAbs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function DeviceDiagnosticsCard(
  { diagnostics: d, class: className }: DeviceDiagnosticsCardProps,
) {
  return (
    <div class={cn("flex flex-col gap-4", className)}>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs uppercase tracking-wide text-muted-foreground">
          Permissions
        </span>
        <PermissionPill value={d.pushPermission} icon={Bell} />
        <PermissionPill value={d.nfcPermission} icon={ScanLine} />
        {d.pushTokenLast8 && (
          <span class="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-700 dark:text-cyan-300">
            <Radio aria-hidden class="size-3" />
            APNs ··{d.pushTokenLast8}
            {d.apnsEnvironment ? ` (${d.apnsEnvironment})` : ""}
          </span>
        )}
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile
          icon={Plug}
          label="Last sync"
          value={formatAbs(d.lastSeenAtIso)}
          accent="teal"
        />
        <MetricTile
          icon={Radio}
          label="Reconnects"
          value={String(d.reconnectCount)}
          accent="teal"
        />
        <MetricTile
          icon={Upload}
          label="Pending uploads"
          value={String(d.pendingUploads)}
          accent="teal"
        />
        <MetricTile
          icon={AppWindow}
          label="App version"
          value={d.appVersion ?? "—"}
          accent="teal"
        />
        <MetricTile
          icon={Layers}
          label="OS version"
          value={d.osVersion ?? "—"}
          accent="teal"
        />
        <MetricTile
          icon={Smartphone}
          label="Model"
          value={d.model ?? d.platform ?? "—"}
          accent="teal"
        />
      </div>

      {d.lastErrorMessage && (
        <div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
          <strong class="font-medium">Last error:</strong> {d.lastErrorMessage}
        </div>
      )}
    </div>
  );
}
