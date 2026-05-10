/**
 * UserFeatureFlagsForm — admin per-user feature-flag editor.
 *
 * Mounted on `/admin/users/:id`. Iterates the registry shipped from
 * the server and renders a per-flag editor sized to the flag's typed
 * value. Editors:
 *
 *   - boolean → checkbox row (mirrors `AppConfigurationForm`)
 *   - string  → `Input` (text)
 *   - int     → `Input type="number"` (integer)
 *   - double  → `Input type="number" step="any"`
 *   - other   → `Textarea` with JSON validation on submit
 *
 * Flags whose `scope === "device"` are disabled (read-only); they can
 * only be edited via the device-detail surface.
 *
 * Per-flag "Reset to default" sends `{value: null}` to the API and
 * removes the user-level row, so the flag falls back to the registry
 * default (or to a device override on the device endpoint).
 *
 * One PATCH per submit covering every changed flag. On success we
 * `location.reload()` so the rest of the page (and any SSE-fed device
 * UI) reflects the new state.
 */

import { useMemo, useState } from "preact/hooks";
import { Loader2, RotateCcw, Save } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { toast } from "sonner";

export type FlagScope = "user" | "device" | "both";

export interface FlagSpecWire {
  key: string;
  name: string;
  description: string;
  scope: FlagScope;
  defaultValue: unknown;
}

interface Props {
  userId: string;
  /** Registry the server shipped down. Order = display order. */
  registry: FlagSpecWire[];
  /**
   * Effective per-user value map at page-load time. A flag missing
   * from this map means "no user-level row" — we display the default
   * but the editor still lets the admin override it.
   */
  initialFlags: Record<string, unknown>;
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
  /** True when the user has explicitly set a value (i.e. not "use default"). */
  hasValue: boolean;
  /** Raw editor state. */
  raw: unknown;
}

export default function UserFeatureFlagsForm(
  { userId, registry, initialFlags }: Props,
) {
  const initial: Record<string, RowDraft> = useMemo(() => {
    const out: Record<string, RowDraft> = {};
    for (const f of registry) {
      const has = Object.prototype.hasOwnProperty.call(initialFlags, f.key);
      out[f.key] = {
        hasValue: has,
        raw: has ? initialFlags[f.key] : f.defaultValue,
      };
    }
    return out;
  }, [registry, initialFlags]);

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
    setDrafts((prev) => ({
      ...prev,
      [key]: { hasValue: true, raw },
    }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const resetToDefault = (key: string) => {
    setDrafts((prev) => {
      const spec = registry.find((f) => f.key === key);
      return {
        ...prev,
        [key]: { hasValue: false, raw: spec?.defaultValue },
      };
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
  } | null => {
    const flags: { key: string; value: unknown }[] = [];
    const perFlagErrors: Record<string, string> = {};
    for (const f of registry) {
      if (f.scope === "device") continue;
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
      try {
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
            const txt = typeof b.raw === "string"
              ? b.raw
              : JSON.stringify(b.raw);
            try {
              parsed = JSON.parse(txt);
            } catch {
              perFlagErrors[f.key] = "Invalid JSON.";
              continue;
            }
            break;
          }
        }
      } catch {
        perFlagErrors[f.key] = "Could not parse value.";
        continue;
      }
      flags.push({ key: f.key, value: parsed });
    }
    if (Object.keys(perFlagErrors).length > 0) {
      return { flags: [], perFlagErrors };
    }
    return { flags, perFlagErrors: {} };
  };

  const onSave = async () => {
    setErrors({});
    const built = buildPatch();
    if (!built) return;
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
        `/api/admin/users/${encodeURIComponent(userId)}/feature-flags`,
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
        toast.error(`Feature flags save failed: ${msg}`);
        return;
      }
      toast.success("Feature flags updated");
      globalThis.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Feature flags save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <ul class="flex flex-col gap-3">
        {registry.map((f) => (
          <FlagRow
            key={f.key}
            spec={f}
            disabled={f.scope === "device" || saving}
            disabledReason={f.scope === "device"
              ? "Device-scoped — edit on the device detail page."
              : null}
            draft={drafts[f.key]}
            initialDraft={initial[f.key]}
            onChange={(v) => updateDraft(f.key, v)}
            onReset={() => resetToDefault(f.key)}
            error={errors[f.key]}
          />
        ))}
      </ul>
      <div class="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving
            ? <Loader2 class="size-4 animate-spin" />
            : <Save class="size-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  spec: FlagSpecWire;
  disabled: boolean;
  disabledReason: string | null;
  draft: RowDraft;
  initialDraft: RowDraft;
  onChange: (v: unknown) => void;
  onReset: () => void;
  error?: string;
}

function FlagRow(props: RowProps) {
  const { spec, disabled, disabledReason, draft, initialDraft, onChange } =
    props;
  const kind = editorKindFor(spec.defaultValue);
  const inheritedDefault = !draft.hasValue;
  return (
    <li
      class={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        inheritedDefault
          ? "border-border bg-card"
          : "border-indigo-500/40 bg-indigo-500/5",
      )}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-0.5">
          <span class="text-sm font-medium">{spec.name}</span>
          <span class="font-mono text-xs text-muted-foreground">
            {spec.key}
          </span>
          <span class="text-xs text-muted-foreground">{spec.description}</span>
          <span class="text-[11px] text-muted-foreground">
            default: <code>{valueToString(spec.defaultValue)}</code>
            {!inheritedDefault && <span class="ml-2">· override active</span>}
          </span>
        </div>
        <div class="flex items-center gap-2">
          {!inheritedDefault && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || initialDraft.hasValue === false &&
                  draft.hasValue === false}
              onClick={props.onReset}
              title="Reset to registry default"
            >
              <RotateCcw class="size-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>
      {disabledReason && (
        <p class="text-[11px] text-muted-foreground italic">{disabledReason}</p>
      )}
      <Editor
        kind={kind}
        value={draft.raw}
        disabled={disabled}
        onChange={onChange}
      />
      {props.error && <p class="text-xs text-destructive">{props.error}</p>}
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
          class="size-4 cursor-pointer accent-indigo-600"
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
