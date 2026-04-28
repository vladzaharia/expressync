/**
 * CapabilityPicker — kind-aware multi-select for the App Configuration
 * tab.
 *
 * Layout: one row per capability, each row carrying an icon, friendly
 * label, one-line description, and a toggle (`<input type="checkbox">`
 * styled like a switch). Read-only capabilities (e.g. `charger` on
 * charger rows) render as a disabled chip rather than a toggle.
 *
 * On Save: PATCH `/api/admin/devices/{id}/capabilities` with the new
 * set. Server-side legality + immutability checks are the source of
 * truth — surfaces are toasts on success / failure. After a successful
 * save the page reloads so the rest of the detail page picks up the
 * change.
 */

import { useState } from "preact/hooks";
import {
  BatteryCharging,
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
import type { DeviceCapability } from "@/src/lib/types/devices.ts";
import {
  CAPABILITY_METADATA,
  pickerOptionsForKind,
} from "@/src/lib/devices/capability-metadata.ts";
import type { DeviceKind } from "@/src/lib/types/devices.ts";

interface Props {
  deviceId: string;
  /** Capabilities currently assigned to the device. */
  current: DeviceCapability[];
  /**
   * Kind-aware option derivation. When provided, `editable` / `readOnly`
   * are derived from `pickerOptionsForKind(kind)` and any explicit
   * `editable` / `readOnly` props are ignored. Slice O passes
   * `kind="charger"` from the chargers admin page; the devices page
   * passes the explicit arrays for backwards compatibility.
   */
  kind?: DeviceKind | "charger";
  /** Editable options from `pickerOptionsForKind`. Optional when `kind` is set. */
  editable?: DeviceCapability[];
  /** Read-only chips. Optional when `kind` is set. */
  readOnly?: DeviceCapability[];
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

export default function CapabilityPicker(
  { deviceId, current, kind, editable, readOnly }: Props,
) {
  // Kind-aware derivation. `kind` overrides explicit arrays so the
  // picker stays kind-correct even if a stale prop slips through.
  const derived = kind ? pickerOptionsForKind(kind) : null;
  const editableList: DeviceCapability[] = derived
    ? [...derived.editable] as DeviceCapability[]
    : editable ?? [];
  const readOnlyList: DeviceCapability[] = derived
    ? [...derived.readOnly] as DeviceCapability[]
    : readOnly ?? [];

  const [selected, setSelected] = useState<Set<DeviceCapability>>(
    new Set(current),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = (() => {
    if (selected.size !== current.length) return true;
    for (const c of current) if (!selected.has(c)) return true;
    return false;
  })();

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
      // Preserve any read-only capabilities (e.g. charger). These are
      // present in `current` but not toggleable; the server expects the
      // FULL desired set.
      const next = new Set(selected);
      for (const c of readOnlyList) {
        if (current.includes(c)) next.add(c);
      }
      const res = await fetch(
        `/api/admin/devices/${deviceId}/capabilities`,
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
        toast.error(`Save failed: ${msg}`);
        return;
      }
      toast.success("Capabilities updated");
      // Reload so the rest of the page reflects the new set.
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
      <ul class="flex flex-col gap-2">
        {
          /* Read-only / auto-managed caps (e.g. `charger` on a charger
            row) render first so the identity-defining capability sits
            at the top of the list, with editable toggles below. */
        }
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
                <label
                  class="text-sm font-medium"
                  for={`cap-${c}`}
                >
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

      {error && <p class="text-xs text-destructive">{error}</p>}

      <div class="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving
            ? <Loader2 class="size-4 animate-spin" />
            : <Save class="size-4" />}
          Save capabilities
        </Button>
      </div>
    </div>
  );
}
