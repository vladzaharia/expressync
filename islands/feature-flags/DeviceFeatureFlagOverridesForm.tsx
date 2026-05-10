/**
 * DeviceFeatureFlagOverridesForm — admin per-device feature-flag overrides.
 *
 * Mounted on `/admin/devices/:id` only when
 * `isFeatureFlagEligibleKind(device.kind)` is true. Charger-kind rows
 * never see this island. Defensive: if mounted with a non-eligible
 * kind we early-return null.
 *
 * For each registry flag we display:
 *   - The user-level inherited value (read-only chip)
 *   - The registry default (read-only chip)
 *   - An editor for the device override
 *
 * Flags whose `scope === "user"` are read-only; they cannot be
 * overridden at the device layer.
 */

import { useMemo, useState } from "preact/hooks";
import { Loader2, RotateCcw, Save } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { toast } from "sonner";

const FEATURE_FLAG_DEVICE_KINDS = [
  "phone_nfc",
  "tablet_nfc",
  "laptop_nfc",
] as const;

function isEligibleKind(kind: string): boolean {
  return (FEATURE_FLAG_DEVICE_KINDS as readonly string[]).includes(kind);
}

export type FlagScope = "user" | "device" | "both";

export interface FlagSpecWire {
  key: string;
  name: string;
  description: string;
  scope: FlagScope;
  defaultValue: unknown;
}

interface Props {
  deviceId: string;
  /** `kind` from the `devices` row. Used as a defensive guard. */
  deviceKind: string;
  registry: FlagSpecWire[];
  /**
   * Existing device overrides at page-load time. A flag missing from
   * this map means "no override" — we show the inherited user value
   * but the editor can still set one.
   */
  initialOverrides: Record<string, unknown>;
  /**
   * Effective user-level values inherited from the user-defaults
   * layer (defaults synthesised when no row supplies a value).
   */
  userValues: Record<string, unknown>;
}

type EditorKind = "bool" | "string" | "int" | "double" | "json";

function editorKindFor(defaultValue: unknown): EditorKind {
  if (typeof defaultValue === "boolean") return "bool";
  if (typeof defaultValue === "string") return "string";
  if (typeof defaultValue === "number") {
    return Number.isInteger(defaultValue) ? "int" : "double";
  }
  return "json";
}

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface RowDraft {
  hasValue: boolean;
  raw: unknown;
}

export default function DeviceFeatureFlagOverridesForm(props: Props) {
  // Defensive: parent should not mount this for charger kinds, but
  // a stale parent shouldn't be able to render a form that the API
  // will reject with 422.
  if (!isEligibleKind(props.deviceKind)) return null;

  const { deviceId, registry, initialOverrides, userValues } = props;

  const initial: Record<string, RowDraft> = useMemo(() => {
    const out: Record<string, RowDraft> = {};
    for (const f of registry) {
      const has = Object.prototype.hasOwnProperty.call(initialOverrides, f.key);
      out[f.key] = {
        hasValue: has,
        raw: has ? initialOverrides[f.key] : (
          Object.prototype.hasOwnProperty.call(userValues, f.key)
            ? userValues[f.key]
            : f.defaultValue
        ),
      };
    }
    return out;
  }, [registry, initialOverrides, userValues]);

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = useMemo(() => {
    for (const f of registry) {
      const a = initial[f.key];
      const b = drafts[f.key];
      if (a.hasValue !== b.hasValue) return true;
      if (a.hasValue && JSON.stringify(a.raw) !== JSON.stringify(b.raw)) {
        return true;
      }
    }
    return false;
  }, [registry, initial, drafts]);

  const updateDraft = (key: string, raw: unknown) => {
    setDrafts((prev) => ({ ...prev, [key]: { hasValue: true, raw } }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearOverride = (key: string) => {
    setDrafts((prev) => {
      const f = registry.find((s) => s.key === key);
      const inherited = f &&
          Object.prototype.hasOwnProperty.call(userValues, key)
        ? userValues[key]
        : f?.defaultValue;
      return { ...prev, [key]: { hasValue: false, raw: inherited } };
    });
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const buildPatch = (): {
    flags: { key: string; value: unknown }[];
    perFlagErrors: Record<string, string>;
  } => {
    const flags: { key: string; value: unknown }[] = [];
    const perFlagErrors: Record<string, string> = {};
    for (const f of registry) {
      if (f.scope === "user") continue;
      const a = initial[f.key];
      const b = drafts[f.key];
      const sameHas = a.hasValue === b.hasValue;
      const sameRaw = a.hasValue && b.hasValue &&
        JSON.stringify(a.raw) === JSON.stringify(b.raw);
      if (sameHas && sameRaw) continue;
      if (sameHas && !a.hasValue) continue;

      if (!b.hasValue) {
        flags.push({ key: f.key, value: null });
        continue;
      }
      const kind = editorKindFor(f.defaultValue);
      let parsed: unknown = b.raw;
      switch (kind) {
        case "bool":
          parsed = Boolean(b.raw);
          break;
        case "string":
          parsed = String(b.raw ?? "");
          break;
        case "int": {
          const n = Number(b.raw);
          if (!Number.isFinite(n) || !Number.isInteger(n)) {
            perFlagErrors[f.key] = "Must be a whole number.";
            continue;
          }
          parsed = n;
          break;
        }
        case "double": {
          const n = Number(b.raw);
          if (!Number.isFinite(n)) {
            perFlagErrors[f.key] = "Must be a number.";
            continue;
          }
          parsed = n;
          break;
        }
        case "json": {
          const txt = typeof b.raw === "string" ? b.raw : JSON.stringify(b.raw);
          try {
            parsed = JSON.parse(txt);
          } catch {
            perFlagErrors[f.key] = "Invalid JSON.";
            continue;
          }
          break;
        }
      }
      flags.push({ key: f.key, value: parsed });
    }
    return { flags, perFlagErrors };
  };

  const onSave = async () => {
    setErrors({});
    const built = buildPatch();
    if (Object.keys(built.perFlagErrors).length > 0) {
      setErrors(built.perFlagErrors);
      return;
    }
    if (built.flags.length === 0) {
      toast.message("No changes to save");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/devices/${encodeURIComponent(deviceId)}/feature-flags`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flags: built.flags }),
        },
      );
      if (!res.ok) {
        const body: Record<string, unknown> = await res.json().catch(
          () => ({}),
        );
        const k = typeof body.key === "string" ? body.key : null;
        const msg = typeof body.error === "string"
          ? body.error
          : `HTTP ${res.status}`;
        if (k) setErrors((prev) => ({ ...prev, [k]: msg }));
        toast.error(`Feature flag overrides save failed: ${msg}`);
        return;
      }
      toast.success("Feature flag overrides updated");
      globalThis.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Feature flag overrides save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <ul class="flex flex-col gap-3">
        {registry.map((f) => {
          const inherited = Object.prototype.hasOwnProperty.call(
              userValues,
              f.key,
            )
            ? userValues[f.key]
            : f.defaultValue;
          const userOverride = Object.prototype.hasOwnProperty.call(
            userValues,
            f.key,
          );
          return (
            <FlagRow
              key={f.key}
              spec={f}
              inherited={inherited}
              userHasValue={userOverride}
              draft={drafts[f.key]}
              hasInitialOverride={initial[f.key].hasValue}
              disabled={f.scope === "user" || saving}
              disabledReason={f.scope === "user"
                ? "User-scoped — edit on the user detail page."
                : null}
              onChange={(v) => updateDraft(f.key, v)}
              onClearOverride={() => clearOverride(f.key)}
              error={errors[f.key]}
            />
          );
        })}
      </ul>
      <div class="flex justify-end">
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving
            ? <Loader2 class="size-4 animate-spin" />
            : <Save class="size-4" />}
          Save overrides
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  spec: FlagSpecWire;
  inherited: unknown;
  userHasValue: boolean;
  draft: RowDraft;
  hasInitialOverride: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onChange: (v: unknown) => void;
  onClearOverride: () => void;
  error?: string;
}

function FlagRow(p: RowProps) {
  const kind = editorKindFor(p.spec.defaultValue);
  const overrideActive = p.draft.hasValue;
  return (
    <li
      class={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        overrideActive
          ? "border-teal-500/40 bg-teal-500/5"
          : "border-border bg-card",
      )}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-0.5">
          <span class="text-sm font-medium">{p.spec.name}</span>
          <span class="font-mono text-xs text-muted-foreground">
            {p.spec.key}
          </span>
          <span class="text-xs text-muted-foreground">
            {p.spec.description}
          </span>
          <span class="text-[11px] text-muted-foreground">
            scope: {p.spec.scope} · default:{" "}
            <code>{valueToString(p.spec.defaultValue)}</code>
            {p.userHasValue && (
              <span class="ml-2">
                · user value: <code>{valueToString(p.inherited)}</code>
              </span>
            )}
            {overrideActive && (
              <span class="ml-2">· device override active</span>
            )}
          </span>
        </div>
        <div class="flex items-center gap-2">
          {overrideActive && (
            <Button
              variant="outline"
              size="sm"
              disabled={p.disabled}
              onClick={p.onClearOverride}
              title="Clear device override (inherit user/default)"
            >
              <RotateCcw class="size-3.5" />
              Clear override
            </Button>
          )}
        </div>
      </div>
      {p.disabledReason && (
        <p class="text-[11px] text-muted-foreground italic">
          {p.disabledReason}
        </p>
      )}
      <Editor
        kind={kind}
        value={p.draft.raw}
        disabled={p.disabled}
        onChange={p.onChange}
      />
      {p.error && <p class="text-xs text-destructive">{p.error}</p>}
    </li>
  );
}

function Editor(
  { kind, value, disabled, onChange }: {
    kind: EditorKind;
    value: unknown;
    disabled: boolean;
    onChange: (v: unknown) => void;
  },
) {
  if (kind === "bool") {
    const checked = Boolean(value);
    return (
      <label class="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) =>
            onChange((e.currentTarget as HTMLInputElement).checked)}
          class="size-4 cursor-pointer accent-teal-600"
        />
        <span>{checked ? "Enabled" : "Disabled"}</span>
      </label>
    );
  }
  if (kind === "string") {
    return (
      <Input
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
    );
  }
  if (kind === "int" || kind === "double") {
    return (
      <Input
        type="number"
        step={kind === "int" ? "1" : "any"}
        value={value === null || value === undefined ? "" : String(value)}
        disabled={disabled}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
    );
  }
  return (
    <textarea
      class="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      value={valueToString(value)}
      disabled={disabled}
      onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
    />
  );
}
