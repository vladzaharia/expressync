/**
 * DevicePickerInline — unified tap-target picker for the scan-modal.
 *
 * Replaces the legacy `components/customer/ChargerPickerInline.tsx`. The
 * legacy picker only knew about chargers (status string from OCPP, single
 * flat list). After Wave 2 the backend returns `TapTargetEntry` rows that
 * include phones AND chargers in one roster — this picker handles both,
 * groups them, and auto-picks the operator's own phone when that's the
 * only online tap-target.
 *
 * Behavior summary:
 *   - **Auto-pick.** If exactly one online tap-target is `isOwnDevice`
 *     (the admin's phone), `onSelect` fires immediately on mount and the
 *     body collapses to a single "Using your phone to scan…" line. We do
 *     NOT auto-pick chargers — picking a random charger the operator
 *     happens to be near would be the wrong default.
 *   - **Grouped list.** Otherwise we render up to three groups in this
 *     order: "Chargers" (orange BatteryCharging icon), "Your phone"
 *     (Smartphone icon, "(this device)" suffix on the row), "Other
 *     devices" (Smartphone icon). Empty groups are omitted.
 *   - **Server order respected.** The scan-tap-targets endpoint already
 *     sorts by `last_seen_at DESC NULLS LAST`. We leave that order intact
 *     within each group so online rows naturally come first.
 *   - **Offline rows.** Disabled, dimmed, with `aria-disabled`. Click
 *     does nothing. Surfaces the row but communicates it isn't selectable.
 *
 * Why not a flat list? The unified roster mixes "tap your card on this
 * charger over there" with "tap your card on the phone in your hand" — two
 * very different physical actions. Grouping makes the choice obvious and
 * keeps the operator from accidentally arming a charger when they meant
 * to use their own phone.
 */

import { useEffect, useMemo, useRef } from "preact/hooks";
import { BatteryCharging, Smartphone } from "lucide-preact";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";
import type { AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface DevicePickerInlineProps {
  /** Roster from `GET /api/auth/scan-tap-targets`. */
  devices: TapTargetEntry[];
  /**
   * The currently-selected tap target, if any. Used to highlight the
   * matching row when the picker is shown alongside a downstream pairing
   * UI (e.g. while arming). The picker itself doesn't drive selection
   * persistence — the parent owns it.
   */
  selectedDeviceId: string | null;
  /** Fired once the operator picks (or auto-picked) a row. */
  onSelect: (target: TapTargetEntry) => void;
  /** When true, all rows render in a non-interactive state. */
  disabled?: boolean;
  /** Page accent (cyan / orange / teal / …). Defaults to cyan. */
  accent?: AccentColor;
  class?: string;
}

interface GroupSpec {
  key: "chargers" | "own" | "other";
  heading: string;
  icon: typeof BatteryCharging;
  iconClass: string;
  items: TapTargetEntry[];
}

function partition(devices: TapTargetEntry[]): GroupSpec[] {
  const chargers: TapTargetEntry[] = [];
  const own: TapTargetEntry[] = [];
  const other: TapTargetEntry[] = [];
  for (const d of devices) {
    if (d.kind === "charger") {
      chargers.push(d);
    } else if (d.isOwnDevice) {
      own.push(d);
    } else {
      other.push(d);
    }
  }
  const groups: GroupSpec[] = [];
  if (chargers.length > 0) {
    groups.push({
      key: "chargers",
      heading: "Chargers",
      icon: BatteryCharging,
      iconClass: "text-orange-500",
      items: chargers,
    });
  }
  if (own.length > 0) {
    groups.push({
      key: "own",
      heading: "Your phone",
      icon: Smartphone,
      iconClass: "text-cyan-500",
      items: own,
    });
  }
  if (other.length > 0) {
    groups.push({
      key: "other",
      heading: "Other devices",
      icon: Smartphone,
      iconClass: "text-muted-foreground",
      items: other,
    });
  }
  return groups;
}

/**
 * Title for an offline row's secondary line. We don't have a `lastSeenAt`
 * on `TapTargetEntry` (the API trims it), so the row just says "Offline".
 * If we extend the contract later, switch to "Offline — last seen Xm ago".
 */
function offlineSubtitle(): string {
  return "Offline";
}

export function DevicePickerInline({
  devices,
  selectedDeviceId,
  onSelect,
  disabled = false,
  accent: _accent = "cyan",
  class: className,
}: DevicePickerInlineProps) {
  // Compute auto-pick eligibility on every render but only fire `onSelect`
  // once per unique target. The parent's `selectedDeviceId` becoming non-
  // null after our call doesn't re-trigger us; mounting with an already-
  // qualifying roster fires once.
  const autoPickTarget = useMemo<TapTargetEntry | null>(() => {
    const onlineOwn = devices.filter((d) =>
      d.isOwnDevice === true && d.isOnline
    );
    return onlineOwn.length === 1 ? onlineOwn[0] : null;
  }, [devices]);

  const autoPickedRef = useRef<string | null>(null);

  useEffect(() => {
    if (disabled) return;
    if (!autoPickTarget) return;
    if (autoPickedRef.current === autoPickTarget.deviceId) return;
    if (selectedDeviceId === autoPickTarget.deviceId) {
      // Already selected — record it so we don't re-fire.
      autoPickedRef.current = autoPickTarget.deviceId;
      return;
    }
    autoPickedRef.current = autoPickTarget.deviceId;
    onSelect(autoPickTarget);
    // selectedDeviceId is intentionally excluded — we want auto-pick to
    // fire once even if the parent's selection lags by a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPickTarget, disabled]);

  // Auto-pick mode: render a minimal status row instead of a grouped list.
  if (autoPickTarget) {
    return (
      <div
        class={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3",
          className,
        )}
        aria-live="polite"
      >
        <Smartphone aria-hidden class="size-4 text-cyan-500" />
        <span class="text-sm text-foreground">
          Using <span class="font-medium">{autoPickTarget.label}</span> to scan…
        </span>
      </div>
    );
  }

  if (devices.length === 0) return null;
  const groups = partition(devices);
  if (groups.length === 0) return null;

  return (
    <div class={cn("flex flex-col gap-3", className)}>
      {groups.map((group) => (
        <DeviceGroup
          key={group.key}
          group={group}
          selectedDeviceId={selectedDeviceId}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function DeviceGroup({
  group,
  selectedDeviceId,
  disabled,
  onSelect,
}: {
  group: GroupSpec;
  selectedDeviceId: string | null;
  disabled: boolean;
  onSelect: (target: TapTargetEntry) => void;
}) {
  const HeadingIcon = group.icon;
  return (
    <section class="flex flex-col gap-1.5">
      <header class="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <HeadingIcon
          class={cn("size-3.5", group.iconClass)}
          aria-hidden="true"
        />
        <span>{group.heading}</span>
      </header>
      <ul class="flex flex-col gap-1.5">
        {group.items.map((item) => (
          <li key={item.deviceId}>
            <DeviceRow
              entry={item}
              groupKey={group.key}
              selected={selectedDeviceId === item.deviceId}
              disabled={disabled}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeviceRow({
  entry,
  groupKey,
  selected,
  disabled,
  onSelect,
}: {
  entry: TapTargetEntry;
  groupKey: GroupSpec["key"];
  selected: boolean;
  disabled: boolean;
  onSelect: (target: TapTargetEntry) => void;
}) {
  const offline = !entry.isOnline;
  const interactionDisabled = disabled || offline;
  const RowIcon = entry.kind === "charger" ? BatteryCharging : Smartphone;
  const iconTone = entry.kind === "charger"
    ? "text-orange-500"
    : groupKey === "own"
    ? "text-cyan-500"
    : "text-muted-foreground";
  const ownSuffix = groupKey === "own" ? " (this device)" : "";

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
        "group w-full flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-accent/40",
        interactionDisabled &&
          "cursor-not-allowed opacity-50 hover:border-border hover:bg-card",
      )}
    >
      <span class="flex items-center gap-3 min-w-0">
        <RowIcon
          class={cn("size-4 shrink-0", iconTone)}
          aria-hidden="true"
        />
        <span class="flex flex-col min-w-0">
          <span class="text-sm font-semibold text-foreground truncate">
            {entry.label}
            {ownSuffix}
          </span>
          {offline && (
            <span class="text-xs text-muted-foreground truncate">
              {offlineSubtitle()}
            </span>
          )}
        </span>
      </span>
      <span class="flex items-center gap-2 shrink-0">
        {entry.capabilities.length > 0 && !offline && (
          <span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {entry.capabilities.join(" · ")}
          </span>
        )}
        <span
          class={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide",
            offline
              ? "bg-muted text-muted-foreground border-border"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
          )}
        >
          {offline ? "Offline" : "Online"}
        </span>
        {!offline && (
          <span class="inline-flex items-center px-3 h-7 rounded-md border border-input bg-background text-xs font-medium text-foreground">
            Select
          </span>
        )}
      </span>
    </button>
  );
}
