/**
 * DeviceSettingsForm — typed editor over the slice-B `SETTING_KEYS`
 * registry on the App Configuration tab.
 *
 *   - `device.label`              → text input
 *   - `notifications.scanRequest` → toggle
 *
 * Adding a new setting: extend the union below + update the key list
 * in `src/lib/devices/settings-keys.ts`. The PATCH endpoint validates
 * per-key value shape so a typo'd value never round-trips.
 */

import { useState } from "preact/hooks";
import { Bell, Loader2, Save, Tag } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { toast } from "sonner";

interface SettingValueEntry {
  value: unknown;
  updatedAtIso: string;
  updatedBy: string;
}

interface Props {
  deviceId: string;
  /** Full settings blob from `GET .../configuration`. */
  settings: Record<string, SettingValueEntry>;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
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

export default function DeviceSettingsForm({ deviceId, settings }: Props) {
  const labelEntry = settings["device.label"];
  const scanReqEntry = settings["notifications.scanRequest"];

  const [label, setLabel] = useState<string>(
    asString(labelEntry?.value, ""),
  );
  const [scanRequestPush, setScanRequestPush] = useState<boolean>(
    asBool(scanReqEntry?.value, true),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialLabel = asString(labelEntry?.value, "");
  const initialScanReq = asBool(scanReqEntry?.value, true);
  const dirty = label !== initialLabel || scanRequestPush !== initialScanReq;

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const settingsBody: Array<{ key: string; value: unknown }> = [];
      if (label !== initialLabel) {
        settingsBody.push({ key: "device.label", value: label });
      }
      if (scanRequestPush !== initialScanReq) {
        settingsBody.push({
          key: "notifications.scanRequest",
          value: scanRequestPush,
        });
      }
      if (settingsBody.length === 0) return;
      const res = await fetch(
        `/api/admin/devices/${deviceId}/settings`,
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
        toast.error(`Save failed: ${msg}`);
        return;
      }
      toast.success("Settings updated");
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
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <div class="flex items-center gap-2">
          <Tag aria-hidden class="size-4 text-muted-foreground" />
          <label
            for="setting-device-label"
            class="text-sm font-medium"
          >
            Device label
          </label>
        </div>
        <Input
          id="setting-device-label"
          value={label}
          onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)}
          placeholder="Front desk iPhone"
          maxLength={120}
          disabled={saving}
        />
        <p class="text-xs text-muted-foreground">
          {labelEntry
            ? `Last set ${formatTimestamp(labelEntry.updatedAtIso)} by ${
              formatActor(labelEntry.updatedBy)
            }`
            : "Default: derived from the registered device name."}
        </p>
      </div>

      <div class="flex items-center gap-3 rounded-md border border-border bg-card p-4">
        <Bell aria-hidden class="size-4 shrink-0 text-muted-foreground" />
        <div class="flex flex-1 flex-col gap-0.5">
          <label
            for="setting-notifications-scan-request"
            class="text-sm font-medium"
          >
            Scan-arm push notifications
          </label>
          <span class="text-xs text-muted-foreground">
            {scanReqEntry
              ? `Last set ${formatTimestamp(scanReqEntry.updatedAtIso)} by ${
                formatActor(scanReqEntry.updatedBy)
              }`
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

      {error && <p class="text-xs text-destructive">{error}</p>}

      <div class="flex justify-end">
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving
            ? <Loader2 class="size-4 animate-spin" />
            : <Save class="size-4" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}
