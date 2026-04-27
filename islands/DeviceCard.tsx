/**
 * DeviceCard — phone/laptop card variant that mirrors `ChargerCard.tsx`.
 *
 * The `/admin/devices` listing page renders a table by default (phones aren't
 * busy enough to earn the bigger card grid), but providing the card variant
 * keeps parity with `ChargerCard`. A future iteration of the listing — or a
 * cards-vs-table toggle — can reuse this component without rewriting it.
 *
 * Visual layout:
 *   - Top row: device icon (`getDeviceIcon`) with status halo + label/model.
 *   - Capability pills row.
 *   - Metrics row: last seen relative + owner.
 *   - Action row: View / Rename / Force deregister (admin only).
 *
 * No live SSE — devices don't have a meter-value firehose like chargers do.
 * Status comes from the server-derived `isOnline` flag (post-loader filter).
 */

import { ExternalLink } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { CapabilityPill } from "@/components/devices/CapabilityPill.tsx";
import { getDeviceIcon } from "@/src/lib/utils/device-icons.ts";
import {
  DEVICE_STATUS_HALO,
  formatRelative,
  normalizeDeviceStatus,
} from "@/islands/shared/device-visuals.ts";
import DeviceActionsMenu from "@/islands/devices/DeviceActionsMenu.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

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

export interface DeviceCardProps {
  device: DeviceCardDto;
  isAdmin?: boolean;
  class?: string;
}

export default function DeviceCard(
  { device, isAdmin = false, class: className }: DeviceCardProps,
) {
  const status = normalizeDeviceStatus(device.lastSeenAtIso, device.isOnline);
  const Icon = getDeviceIcon(device.kind);
  const halo = DEVICE_STATUS_HALO[status];
  const isOffline = status === "Offline";

  const modelDisplay = device.model ?? device.platform ?? "Unknown model";

  return (
    <div
      class={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground",
        className,
      )}
    >
      <div class="flex w-full flex-col gap-3 p-4">
        <div class="flex items-center gap-3">
          <span
            class={cn(
              "shrink-0 transition-opacity",
              isOffline && "opacity-60",
            )}
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
              {modelDisplay}
              {device.appVersion ? ` · v${device.appVersion}` : ""}
            </span>
          </a>
          <span
            class={cn(
              "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
              status === "Online"
                ? "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
            )}
          >
            {status}
          </span>
        </div>

        <div class="h-px w-full bg-border/60" />

        {device.capabilities.length > 0 && (
          <div class="flex flex-wrap gap-1.5">
            {device.capabilities.map((c) => (
              <CapabilityPill key={c} capability={c} />
            ))}
          </div>
        )}

        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {/* "Last seen" is meaningful only when the device isn't
              currently reachable. The Online pill in the top row
              already conveys liveness when isOnline=true. */}
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
            <span class="text-muted-foreground">Owner:</span>{" "}
            {device.ownerUserId
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

        <div class="h-px w-full bg-border/60" />

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
      </div>
    </div>
  );
}
