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
  Loader2,
  Lock,
  Save,
  Smartphone,
  User,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
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
  { deviceId, kind, current, settings = {} }: Props,
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
  const initialScanReq = asBool(scanReqEntry?.value, true);
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
      <div class="flex flex-col gap-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Capabilities
        </h3>
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
          {editableList.map((c) => {
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
                <input
                  id={`cap-${c}`}
                  type="checkbox"
                  checked={checked}
                  disabled={saving}
                  onChange={() => toggle(c)}
                  class="size-5 cursor-pointer accent-teal-600"
                />
              </li>
            );
          })}
        </ul>
      </div>

      {/* Settings section — app devices only */}
      {!isCharger && (
        <div class="flex flex-col gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Settings
          </h3>
          <div class="flex items-center gap-3 rounded-md border border-border bg-card p-3">
            <Bell aria-hidden class="size-5 shrink-0 text-muted-foreground" />
            <div class="flex flex-1 flex-col gap-0.5">
              <label
                for="setting-notifications-scan-request"
                class="text-sm font-medium"
              >
                Scan-arm push notifications
              </label>
              <span class="text-xs text-muted-foreground">
                {scanReqEntry
                  ? `Last set ${
                    formatTimestamp(scanReqEntry.updatedAtIso)
                  } by ${formatActor(scanReqEntry.updatedBy)}`
                  : "When off, the device only sees scan-arm events while in foreground."}
              </span>
            </div>
            <input
              id="setting-notifications-scan-request"
              type="checkbox"
              checked={scanRequestPush}
              disabled={saving}
              onChange={(e) =>
                setScanRequestPush(
                  (e.currentTarget as HTMLInputElement).checked,
                )}
              class="size-5 cursor-pointer accent-teal-600"
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
