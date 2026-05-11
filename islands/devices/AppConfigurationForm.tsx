/**
 * AppConfigurationForm — single-Save form covering capabilities AND
 * settings on the device detail page (`/admin/devices/:id`). Also
 * powers the slim `Charger Configuration` form on the chargers detail
 * page when `kind === "charger"` (the settings half is suppressed
 * since chargers don't carry per-key device_settings).
 *
 * Behaviour:
 *   - Capabilities are presented as a kind-aware list (read-only chips
 *     for `charger` on a charger row, editable toggles for the rest).
 *   - Settings are presented for the typed registry (today: device
 *     label is moved to the identity-card inline rename, so the only
 *     remaining setting on app devices is `notifications.scanRequest`).
 *   - One "Save" button at the bottom commits both, sequencing two
 *     PATCHes (capabilities first, then settings) so a partial failure
 *     surfaces a toast with which half didn't land.
 *   - On full success the page reloads so the rest of the surface
 *     reflects the new state.
 */

import { useState } from "preact/hooks";
import {
  BatteryCharging,
  Bell,
  Compass,
  Loader2,
  Lock,
  Save,
  Smartphone,
  User,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { CapabilityPill } from "@/components/devices/CapabilityPill.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { toast } from "sonner";
import type { DeviceCapability, DeviceKind } from "@/src/lib/types/devices.ts";
import {
  CAPABILITY_METADATA,
  pickerOptionsForKind,
} from "@/src/lib/devices/capability-metadata.ts";

interface SettingValueEntry {
  value: unknown;
  updatedAtIso: string;
  updatedBy: string;
}

interface Props {
  deviceId: string;
  /** `phone_nfc | tablet_nfc | laptop_nfc | charger`. Drives the kind-aware
   *  picker option set AND whether the settings half renders. */
  kind: DeviceKind | "charger";
  current: DeviceCapability[];
  /** Settings blob from `GET .../configuration`. Empty when the row
   *  carries no per-key settings (e.g. chargers). */
  settings?: Record<string, SettingValueEntry>;
  /** When `false` the "Scanning request notifications" toggle is
   *  disabled (and forced unchecked) — the device has no APNs token,
   *  so there's no useful behaviour to enable. Set `true` once the
   *  device has registered a push token. Defaults to `true` so the
   *  control stays usable on chargers / unwired callers. */
  hasApnsToken?: boolean;
}

function iconFor(c: DeviceCapability) {
  switch (c) {
    case "scanner":
      return Smartphone;
    case "charger":
      return BatteryCharging;
    case "user":
      return User;
    case "kiosk":
      return Lock;
    case "managed":
      // Compass reads as "fleet posture / orientation," differentiating
      // it from the location-pin glyph used for the Location card. The
      // capability is about being part of the managed fleet, not about
      // a single coordinate read.
      return Compass;
  }
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function formatActor(updatedBy: string): string {
  if (updatedBy.startsWith("admin:")) return "Admin";
  if (updatedBy.startsWith("device:")) return "Device";
  return updatedBy || "—";
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AppConfigurationForm(
  { deviceId, kind, current, settings = {}, hasApnsToken = true }: Props,
) {
  const opts = pickerOptionsForKind(kind);
  const editableList = [...opts.editable] as DeviceCapability[];
  const readOnlyList = [...opts.readOnly] as DeviceCapability[];

  // Capability state
  const [selected, setSelected] = useState<Set<DeviceCapability>>(
    new Set(current),
  );

  // Settings state — only `notifications.scanRequest` is wired today.
  // The `device.label` setting is owned by the identity-card rename
  // input, so we don't expose it here.
  const scanReqEntry = settings["notifications.scanRequest"];
  // No APNs token → the toggle is forced off and disabled. Persisting
  // any other value would be misleading because there's no token to
  // push to.
  const initialScanReq = hasApnsToken
    ? asBool(scanReqEntry?.value, true)
    : false;
  const [scanRequestPush, setScanRequestPush] = useState<boolean>(
    initialScanReq,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCharger = kind === "charger";

  const capDirty = (() => {
    if (selected.size !== current.length) return true;
    for (const c of current) if (!selected.has(c)) return true;
    return false;
  })();
  const settingsDirty = !isCharger && scanRequestPush !== initialScanReq;
  const dirty = capDirty || settingsDirty;

  const toggle = (c: DeviceCapability) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Capabilities — preserve any read-only caps already present.
      if (capDirty) {
        const next = new Set(selected);
        for (const c of readOnlyList) {
          if (current.includes(c)) next.add(c);
        }
        const res = await fetch(
          `/api/admin/devices/${encodeURIComponent(deviceId)}/capabilities`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ capabilities: Array.from(next) }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = body.reason || body.error || `HTTP ${res.status}`;
          setError(msg);
          toast.error(`Capabilities save failed: ${msg}`);
          return;
        }
      }

      // Settings — only when the row carries them.
      if (settingsDirty) {
        const settingsBody: Array<{ key: string; value: unknown }> = [];
        if (scanRequestPush !== initialScanReq) {
          settingsBody.push({
            key: "notifications.scanRequest",
            value: scanRequestPush,
          });
        }
        if (settingsBody.length > 0) {
          const res = await fetch(
            `/api/admin/devices/${encodeURIComponent(deviceId)}/settings`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ settings: settingsBody }),
            },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const msg = body.error || `HTTP ${res.status}`;
            setError(msg);
            toast.error(`Settings save failed: ${msg}`);
            return;
          }
        }
      }

      toast.success("Configuration updated");
      globalThis.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex flex-col gap-6">
      {/* Capabilities section */}
      <div class="flex flex-col gap-4">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Capabilities
        </h3>

        {
          /* Read-only / auto-managed (system) capabilities — e.g. `charger`
            on a charger row. Identity-defining, not editable. */
        }
        {readOnlyList.length > 0 && (
          <ul class="flex flex-col gap-2">
            {readOnlyList.map((c) => (
              <li
                key={c}
                class="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3 opacity-80"
              >
                <CapabilityPill capability={c} />
                <span class="flex-1 text-xs text-muted-foreground">
                  {CAPABILITY_METADATA[c].description} (auto-managed)
                </span>
              </li>
            ))}
          </ul>
        )}

        {
          /* Mode group — app-wide cutting concerns (managed, kiosk).
            Rendered first because changing one of these reshapes the
            whole app, not just a single tab. */
        }
        {(() => {
          const modeCaps = editableList.filter(
            (c) => CAPABILITY_METADATA[c].group === "mode",
          );
          if (modeCaps.length === 0) return null;
          return (
            <CapabilityGroup
              title="Mode"
              description="App-wide posture. Changing these reshapes the whole experience."
              caps={modeCaps}
              selected={selected}
              saving={saving}
              onToggle={toggle}
            />
          );
        })()}

        {/* Feature group — discrete feature gates (scanner, user). */}
        {(() => {
          const featureCaps = editableList.filter(
            (c) => CAPABILITY_METADATA[c].group === "feature",
          );
          if (featureCaps.length === 0) return null;
          return (
            <CapabilityGroup
              title="Features"
              description="Optional capability surfaces. Turn on what this device should do."
              caps={featureCaps}
              selected={selected}
              saving={saving}
              onToggle={toggle}
            />
          );
        })()}
      </div>

      {/* Settings section — app devices only */}
      {!isCharger && (
        <div class="flex flex-col gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Settings
          </h3>
          <div
            class={cn(
              "flex items-center gap-3 rounded-md border border-border bg-card p-3",
              !hasApnsToken && "opacity-60",
            )}
          >
            <Bell aria-hidden class="size-5 shrink-0 text-muted-foreground" />
            <div class="flex flex-1 flex-col gap-0.5">
              <label
                for="setting-notifications-scan-request"
                class="text-sm font-medium"
              >
                Scanning request notifications
              </label>
              <span class="text-xs text-muted-foreground">
                {!hasApnsToken
                  ? "Disabled: this device hasn't registered an APNs token, so push can't be delivered."
                  : scanReqEntry
                  ? `Last set ${
                    formatTimestamp(scanReqEntry.updatedAtIso)
                  } by ${formatActor(scanReqEntry.updatedBy)}`
                  : "When off, the device only sees scan-arm events while in foreground."}
              </span>
            </div>
            <Switch
              id="setting-notifications-scan-request"
              aria-label="Toggle scanning request notifications"
              checked={hasApnsToken && scanRequestPush}
              disabled={saving || !hasApnsToken}
              onCheckedChange={(next) => setScanRequestPush(next)}
              className={hasApnsToken ? "" : "cursor-not-allowed"}
            />
          </div>
        </div>
      )}

      {error && <p class="text-xs text-destructive">{error}</p>}

      <div class="flex justify-end">
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving
            ? <Loader2 class="size-4 animate-spin" />
            : <Save class="size-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * One labelled group of capability switches. Used to separate the
 * "mode" group (app-wide cuts) from the "features" group (discrete
 * surface gates) without re-implementing the row layout in two places.
 */
function CapabilityGroup({
  title,
  description,
  caps,
  selected,
  saving,
  onToggle,
}: {
  title: string;
  description: string;
  caps: DeviceCapability[];
  selected: Set<DeviceCapability>;
  saving: boolean;
  onToggle: (c: DeviceCapability) => void;
}) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-col gap-0.5">
        <h4 class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          {title}
        </h4>
        <p class="text-[11px] text-muted-foreground/70">{description}</p>
      </div>
      <ul class="flex flex-col gap-2">
        {caps.map((c) => {
          const meta = CAPABILITY_METADATA[c];
          const Icon = iconFor(c);
          const checked = selected.has(c);
          return (
            <li
              key={c}
              class={cn(
                "flex items-center gap-3 rounded-md border p-3 transition-colors",
                checked
                  ? "border-teal-500/40 bg-teal-500/5"
                  : "border-border bg-card",
              )}
            >
              <Icon
                aria-hidden
                class={cn(
                  "size-5 shrink-0",
                  checked
                    ? "text-teal-600 dark:text-teal-400"
                    : "text-muted-foreground",
                )}
              />
              <div class="flex flex-1 flex-col gap-0.5">
                <label class="text-sm font-medium" for={`cap-${c}`}>
                  {meta.label}
                </label>
                <span class="text-xs text-muted-foreground">
                  {meta.description}
                </span>
              </div>
              <Switch
                id={`cap-${c}`}
                aria-label={`Toggle ${meta.label}`}
                checked={checked}
                disabled={saving}
                onCheckedChange={() => onToggle(c)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
