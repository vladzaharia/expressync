/**
 * GlobalFeatureFlagsForm — registry-level editor for global flag values.
 *
 * Renders the registry on `/admin/feature-flags` with one editor row
 * per flag. Each row carries:
 *   - flag name + key + description
 *   - registry default (read-only)
 *   - global override editor (matching the value type)
 *   - reset button (clears the global row, falling back to the
 *     registry default)
 *
 * On save: PATCH /api/admin/feature-flags with the changed entries.
 * Effective precedence (resolver-side) is:
 *   device override > user value > global value > registry default.
 *
 * Kept slim — only `boolean`, `string`, `int`, `double`, and `json`
 * value editors today. Mirrors `UserFeatureFlagsForm`'s row shape so
 * the visual language stays consistent.
 */

import { useMemo, useState } from "preact/hooks";
import { Loader2, RotateCcw, Save } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { toast } from "sonner";

type Kind = "bool" | "string" | "int" | "double" | "json";

interface FlagSpec {
  key: string;
  name: string;
  description: string;
  kind: Kind;
  defaultValue: unknown;
  /** Currently-set global value, or undefined if unset (falls back to default). */
  globalValue?: unknown;
}

interface Props {
  flags: FlagSpec[];
}

interface Draft {
  hasValue: boolean;
  raw: unknown;
}

function kindFromDefault(v: unknown): Kind {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "double";
  return "json";
}

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export default function GlobalFeatureFlagsForm({ flags }: Props) {
  const initialDrafts = useMemo<Record<string, Draft>>(() => {
    const out: Record<string, Draft> = {};
    for (const f of flags) {
      out[f.key] = f.globalValue === undefined
        ? { hasValue: false, raw: f.defaultValue }
        : { hasValue: true, raw: f.globalValue };
    }
    return out;
  }, [flags]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>(initialDrafts);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    return flags.some((f) => {
      const a = initialDrafts[f.key];
      const b = drafts[f.key];
      if (a.hasValue !== b.hasValue) return true;
      if (!a.hasValue && !b.hasValue) return false;
      return JSON.stringify(a.raw) !== JSON.stringify(b.raw);
    });
  }, [flags, initialDrafts, drafts]);

  const onSave = async () => {
    setSaving(true);
    try {
      // Build PATCH payload: entries where draft != initial.
      const entries: { key: string; value: unknown }[] = [];
      for (const f of flags) {
        const a = initialDrafts[f.key];
        const b = drafts[f.key];
        const changed = a.hasValue !== b.hasValue ||
          (a.hasValue && JSON.stringify(a.raw) !== JSON.stringify(b.raw));
        if (!changed) continue;
        entries.push({
          key: f.key,
          value: b.hasValue ? b.raw : null,
        });
      }
      if (entries.length === 0) return;

      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flags: entries }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(
          `Save failed: ${
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          }`,
        );
        return;
      }
      toast.success("Global flags updated");
      globalThis.location.reload();
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <ul class="flex flex-col gap-2">
        {flags.map((f) => (
          <FlagRow
            key={f.key}
            spec={f}
            draft={drafts[f.key]}
            initialDraft={initialDrafts[f.key]}
            disabled={saving}
            onChange={(next) =>
              setDrafts((p) => ({ ...p, [f.key]: next }))}
            onReset={() =>
              setDrafts((p) => ({
                ...p,
                [f.key]: { hasValue: false, raw: f.defaultValue },
              }))}
          />
        ))}
      </ul>
      <div class="flex justify-end">
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving
            ? <Loader2 class="size-4 animate-spin" />
            : <Save class="size-4" />}
          Save global flags
        </Button>
      </div>
    </div>
  );
}

function FlagRow(props: {
  spec: FlagSpec;
  draft: Draft;
  initialDraft: Draft;
  disabled: boolean;
  onChange: (next: Draft) => void;
  onReset: () => void;
}) {
  const { spec, draft, initialDraft, disabled } = props;
  const overrideActive = draft.hasValue;
  return (
    <li
      class={cn(
        "rounded-md border p-3 transition-colors",
        overrideActive
          ? "border-indigo-500/40 bg-indigo-500/5"
          : "border-border bg-card",
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
            {overrideActive && <span class="ml-2">· global override active</span>}
          </span>
        </div>
        <div class="flex items-center gap-2">
          {overrideActive && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled ||
                (!initialDraft.hasValue && !draft.hasValue)}
              onClick={props.onReset}
              title="Reset to registry default"
            >
              <RotateCcw class="size-3.5" />
              <span class="sr-only">Reset</span>
            </Button>
          )}
        </div>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <ValueEditor
          kind={spec.kind}
          value={draft.hasValue ? draft.raw : spec.defaultValue}
          disabled={disabled}
          onChange={(next) =>
            props.onChange({ hasValue: true, raw: next })}
        />
      </div>
    </li>
  );
}

function ValueEditor(props: {
  kind: Kind;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}) {
  const { kind, value, disabled, onChange } = props;
  if (kind === "bool") {
    return (
      <Switch
        aria-label="Toggle global flag value"
        checked={Boolean(value)}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next)}
      />
    );
  }
  if (kind === "int" || kind === "double") {
    return (
      <Input
        type="number"
        step={kind === "int" ? "1" : "any"}
        value={typeof value === "number" ? String(value) : ""}
        disabled={disabled}
        onInput={(e) => {
          const raw = (e.currentTarget as HTMLInputElement).value;
          const num = kind === "int" ? parseInt(raw, 10) : parseFloat(raw);
          onChange(Number.isFinite(num) ? num : raw);
        }}
        className="max-w-[180px]"
      />
    );
  }
  if (kind === "string") {
    return (
      <Input
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onInput={(e) =>
          onChange((e.currentTarget as HTMLInputElement).value)}
        className="max-w-[320px]"
      />
    );
  }
  // json
  return (
    <textarea
      class="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      value={(() => {
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return String(value);
        }
      })()}
      disabled={disabled}
      onInput={(e) => {
        const raw = (e.currentTarget as HTMLTextAreaElement).value;
        try {
          onChange(JSON.parse(raw));
        } catch {
          onChange(raw);
        }
      }}
    />
  );
}
