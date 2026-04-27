/**
 * DevicePickerInline — unified tap-target picker.
 *
 * One flat list of "tappable devices" — chargers and phones treated as
 * equals. The card chrome is identical; the only per-row differentiator
 * is a kind icon (a charger looks different from a phone, and that
 * recognition aid is worth keeping). Online state drives both row
 * tone (foreground vs muted) and clickability (offline rows are
 * disabled and aria-disabled).
 *
 * Audience filter (the only mode-driven difference):
 *   - "admin"    — every tappable device, including offline. Admins need
 *                  to see fleet health and pick offline devices for
 *                  diagnostics.
 *   - "customer" — chargers (any state, offline dimmed) plus online
 *                  non-charger devices. Offline non-chargers are filtered
 *                  out so customers don't see stale phones; online
 *                  admin phones remain visible so a customer can be
 *                  signed in remotely on an admin's device.
 *
 * No auto-pick. The picker always renders, even with one online device.
 */

import { useMemo } from "preact/hooks";
import { BatteryCharging, Smartphone } from "lucide-preact";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";
import type { AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import { tapTargetDisplayName } from "@/components/scan/display-name.ts";

export interface DevicePickerInlineProps {
  /** Roster from `GET /api/auth/scan-tap-targets`. */
  devices: TapTargetEntry[];
  /** Currently-selected target id (highlighted row). Null for none. */
  selectedDeviceId: string | null;
  /** Fired once the operator picks an online row. */
  onSelect: (target: TapTargetEntry) => void;
  /** When true, all rows render in a non-interactive state. */
  disabled?: boolean;
  /** Audience the picker is rendering for — drives offline-row visibility. */
  mode?: "admin" | "customer";
  /** Page accent. Used for the selected-row highlight ring. */
  accent?: AccentColor;
  class?: string;
}

function rowIcon(entry: TapTargetEntry) {
  return entry.kind === "charger" ? BatteryCharging : Smartphone;
}

function ownSuffix(entry: TapTargetEntry): string {
  return entry.isOwnDevice ? " (this device)" : "";
}

function sortDevices(list: TapTargetEntry[]): TapTargetEntry[] {
  // Online first, then alphabetical by display name. Stable across renders
  // so the picker doesn't reorder while a roster refetch is in flight.
  return [...list].sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return tapTargetDisplayName(a).localeCompare(tapTargetDisplayName(b));
  });
}

export function DevicePickerInline({
  devices,
  selectedDeviceId,
  onSelect,
  disabled = false,
  mode = "admin",
  accent: _accent = "cyan",
  class: className,
}: DevicePickerInlineProps) {
  const visible = useMemo(() => {
    const filtered = mode === "admin"
      ? devices
      : devices.filter((d) => d.kind === "charger" || d.isOnline);
    return sortDevices(filtered);
  }, [devices, mode]);

  if (visible.length === 0) return null;

  return (
    <ul class={cn("flex flex-col gap-2", className)}>
      {visible.map((entry) => (
        <li key={entry.deviceId}>
          <DeviceRow
            entry={entry}
            selected={selectedDeviceId === entry.deviceId}
            disabled={disabled}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

function DeviceRow({
  entry,
  selected,
  disabled,
  onSelect,
}: {
  entry: TapTargetEntry;
  selected: boolean;
  disabled: boolean;
  onSelect: (target: TapTargetEntry) => void;
}) {
  const offline = !entry.isOnline;
  const interactionDisabled = disabled || offline;
  const RowIcon = rowIcon(entry);

  return (
    <button
      type="button"
      disabled={interactionDisabled}
      aria-disabled={interactionDisabled}
      aria-pressed={selected}
      onClick={() => {
        if (!interactionDisabled) onSelect(entry);
      }}
      class={cn(
        "group w-full flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary/60 bg-primary/5 ring-2 ring-primary/40"
          : "border-border hover:border-primary/40 hover:bg-accent/40",
        interactionDisabled &&
          "cursor-not-allowed opacity-50 hover:border-border hover:bg-card",
      )}
    >
      <span class="flex items-center gap-3 min-w-0">
        <RowIcon
          class={cn(
            "size-5 shrink-0",
            offline ? "text-muted-foreground" : "text-foreground",
          )}
          aria-hidden="true"
        />
        <span class="text-sm font-semibold text-foreground truncate">
          {tapTargetDisplayName(entry)}
          {ownSuffix(entry)}
        </span>
      </span>
      <span
        class={cn(
          "shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide",
          offline
            ? "bg-muted text-muted-foreground border-border"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
        )}
      >
        {offline ? "Offline" : "Online"}
      </span>
    </button>
  );
}
