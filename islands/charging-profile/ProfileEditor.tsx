/**
 * Phase P5 — ProfileEditor island
 *
 * 2-column editor at `lg:` (stacks on mobile). Left: preset picker (6
 * cards) + ScheduleGrid read-only preview for the chosen preset, or
 * interactive grid for "custom". Right: summary + save/cancel + apply-
 * now checkbox + danger zone (Clear = apply Unlimited).
 *
 * Discovery: no nav item. Reached via sibling's Link-detail chip, Tag-
 * detail chip, or Charger detail 24h section.
 */

import { useComputed, useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";
import { toast } from "sonner";
import {
  BatteryCharging,
  Gauge,
  Infinity as InfinityIcon,
  Loader2,
  Moon,
  Pencil,
  Sun,
  Trash2,
  Zap,
} from "lucide-preact";
import ScheduleGrid, { type ScheduleWindow } from "./ScheduleGrid.tsx";
import { PresetCard } from "@/components/charging-profile/PresetCard.tsx";
import { ProfileStatusBadge } from "@/components/charging-profile/ProfileStatusBadge.tsx";

type Preset =
  | "unlimited"
  | "offpeak"
  | "cap7kw"
  | "cap11kw"
  | "solar"
  | "custom";

export interface ProfileEditorProps {
  externalId: string;
  initialProfile: {
    id: number;
    preset: Preset;
    windows: ScheduleWindow[];
    maxWGlobal: number | null;
    lagoSyncError?: string | null;
  } | null;
}

interface PresetDef {
  id: Preset;
  title: string;
  description: string;
  icon: preact.JSX.Element;
  disabled?: boolean;
  disabledReason?: string;
}

const PRESETS: PresetDef[] = [
  {
    id: "unlimited",
    title: "Unlimited",
    description: "No caps, charge any time.",
    icon: <InfinityIcon className="size-5" aria-hidden="true" />,
  },
  {
    id: "offpeak",
    title: "Off-peak only",
    description: "Weeknights 22:00–06:00 + weekends.",
    icon: <Moon className="size-5" aria-hidden="true" />,
  },
  {
    id: "cap7kw",
    title: "Cap at 7 kW",
    description: "Always on, max 7 kW per session.",
    icon: <Gauge className="size-5" aria-hidden="true" />,
  },
  {
    id: "cap11kw",
    title: "Cap at 11 kW",
    description: "Always on, max 11 kW per session.",
    icon: <Zap className="size-5" aria-hidden="true" />,
  },
  {
    id: "solar",
    title: "Solar surplus",
    description: "Match excess PV generation.",
    icon: <Sun className="size-5" aria-hidden="true" />,
    disabled: true,
    disabledReason: "Coming soon: requires solar integration.",
  },
  {
    id: "custom",
    title: "Custom",
    description: "Draw your own schedule.",
    icon: <Pencil className="size-5" aria-hidden="true" />,
  },
];

// Mirror of service preset builder. Kept client-side to provide an
// instant visual preview without round-tripping.
function buildPresetWindows(preset: Preset): ScheduleWindow[] {
  if (preset === "offpeak") {
    const w: ScheduleWindow[] = [];
    for (const dow of [1, 2, 3, 4, 5]) {
      w.push({ dayOfWeek: dow, startMin: 0, endMin: 6 * 60 });
      w.push({ dayOfWeek: dow, startMin: 22 * 60, endMin: 24 * 60 });
    }
    w.push({ dayOfWeek: 0, startMin: 0, endMin: 24 * 60 });
    w.push({ dayOfWeek: 6, startMin: 0, endMin: 24 * 60 });
    return w;
  }
  return [];
}

function defaultMaxW(preset: Preset): number | null {
  if (preset === "cap7kw") return 7000;
  if (preset === "cap11kw") return 11000;
  return null;
}

export default function ProfileEditor(
  { externalId, initialProfile }: ProfileEditorProps,
) {
  const preset = useSignal<Preset>(initialProfile?.preset ?? "unlimited");
  const customWindows = useSignal<ScheduleWindow[]>(
    initialProfile?.preset === "custom" ? (initialProfile?.windows ?? []) : [],
  );
  const customMaxW = useSignal<number | null>(
    initialProfile?.preset === "custom"
      ? (initialProfile?.maxWGlobal ?? null)
      : null,
  );
  const applyNow = useSignal(false);
  const saving = useSignal(false);
  const clearing = useSignal(false);
  const lagoError = useSignal<string | null>(
    initialProfile?.lagoSyncError ?? null,
  );
  const synced = useSignal<boolean>(
    !!initialProfile && !initialProfile?.lagoSyncError,
  );

  const previewWindows = useComputed<ScheduleWindow[]>(() => {
    if (preset.value === "custom") return customWindows.value;
    return buildPresetWindows(preset.value);
  });

  const previewMaxW = useComputed<number | null>(() => {
    if (preset.value === "custom") return customMaxW.value;
    return defaultMaxW(preset.value);
  });

  const summary = useComputed(() => {
    const p = PRESETS.find((x) => x.id === preset.value);
    const title = p?.title ?? preset.value;
    const cap = previewMaxW.value
      ? ` (${(previewMaxW.value / 1000).toFixed(0)} kW cap)`
      : "";
    return `${title}${cap}`;
  });

  async function handleSave() {
    if (saving.value) return;
    saving.value = true;
    try {
      const body: Record<string, unknown> = {
        preset: preset.value,
        applyNow: applyNow.value,
      };
      if (preset.value === "custom") {
        body.windows = customWindows.value;
        body.maxWGlobal = customMaxW.value;
      }
      const res = await fetch(
        `/api/admin/charging-profile/${encodeURIComponent(externalId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "Failed to save profile");
        return;
      }
      const data = await res.json();
      if (data.lagoMirrorOk === false) {
        lagoError.value = data.lagoMirrorError ?? "unknown";
        synced.value = false;
        toast.warning(
          "Saved locally. Lago mirror failed; will retry later.",
        );
      } else {
        lagoError.value = null;
        synced.value = true;
        toast.success("Charging profile saved.");
      }
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      saving.value = false;
    }
  }

  async function handleClear() {
    if (clearing.value) return;
    if (
      !globalThis.confirm(
        "Clear the charging profile? This applies the Unlimited preset.",
      )
    ) return;
    clearing.value = true;
    try {
      const res = await fetch(
        `/api/admin/charging-profile/${encodeURIComponent(externalId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast.error("Failed to clear profile");
        return;
      }
      const data = await res.json();
      preset.value = "unlimited";
      customWindows.value = [];
      customMaxW.value = null;
      lagoError.value = data.lagoMirrorError ?? null;
      synced.value = !!data.lagoMirrorOk;
      toast.success("Cleared to Unlimited.");
    } catch (err) {
      toast.error(
        `Clear failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearing.value = false;
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Toaster />
      <section aria-label="Preset picker" className="lg:col-span-2 space-y-6">
        <div
          role="radiogroup"
          aria-label="Charging preset"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              id={p.id}
              title={p.title}
              description={p.description}
              icon={p.icon}
              selected={preset.value === p.id}
              disabled={p.disabled}
              disabledReason={p.disabledReason}
              onSelect={() => {
                preset.value = p.id;
              }}
            />
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Schedule preview</Label>
            {preset.value === "custom" && (
              <p className="text-xs text-muted-foreground">
                Click or drag cells to toggle.
              </p>
            )}
          </div>
          <ScheduleGrid
            windows={previewWindows.value}
            readOnly={preset.value !== "custom"}
            onChange={(next) => {
              customWindows.value = next;
            }}
          />
        </div>

        {preset.value === "custom" && (
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="customMaxW">
              Global power cap (Watts, optional)
            </Label>
            <Input
              id="customMaxW"
              type="number"
              min={0}
              step={500}
              placeholder="e.g. 7000"
              value={customMaxW.value ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                customMaxW.value = v ? parseInt(v, 10) : null;
              }}
            />
          </div>
        )}
      </section>

      <aside aria-label="Summary and actions" className="space-y-4">
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Summary</h3>
            <ProfileStatusBadge
              lagoSynced={synced.value}
              error={lagoError.value}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Active profile: <strong>{summary.value}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Subscription <span className="font-mono">{externalId}</span>
          </p>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="applyNow"
              checked={applyNow.value}
              onCheckedChange={(checked) => {
                applyNow.value = !!checked;
              }}
            />
            <div className="flex-1">
              <Label
                htmlFor="applyNow"
                className="cursor-pointer text-sm font-medium"
              >
                Apply to active sessions now
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Immediately patches any in-progress charging sessions for this
                subscription. If unchecked, the new profile takes effect on the
                next session start.
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={handleSave}
            disabled={saving.value ||
              PRESETS.find((p) => p.id === preset.value)?.disabled}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving.value
              ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              )
              : (
                <>
                  <BatteryCharging className="size-4" />
                  Save profile
                </>
              )}
          </Button>
          <Button
            type="button"
            variant="outline"
            asChild
            className="w-full"
          >
            <a href="/links">Cancel</a>
          </Button>
        </div>

        <div className="rounded-lg border border-destructive/40 p-4 space-y-3">
          <h3 className="font-semibold text-sm text-destructive">
            Danger zone
          </h3>
          <p className="text-xs text-muted-foreground">
            Clear applies the Unlimited preset and removes all caps.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={clearing.value}
            className="w-full border-destructive/60 text-destructive hover:bg-destructive/10"
          >
            {clearing.value
              ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Clearing...
                </>
              )
              : (
                <>
                  <Trash2 className="size-4" />
                  Clear profile
                </>
              )}
          </Button>
        </div>
      </aside>
    </div>
  );
}
