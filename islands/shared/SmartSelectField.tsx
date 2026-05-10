/**
 * SmartSelectField — click-to-edit select. Companion to SmartTextField:
 * renders the selected option's label as plain text by default; click
 * opens the shadcn Select primitive. Saves on selection, cancels on
 * outside-click before commit.
 *
 * The "null" value (clear / unset) is supported via `nullLabel` and
 * encoded internally as `__null__` — the consumer's `onSave` receives
 * `string | null`.
 */

import { useState } from "preact/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

const NULL_OPTION = "__null__";

export interface SmartSelectOption {
  value: string;
  label: string;
}

interface SmartSelectFieldProps {
  /** Current value. `null` displays `nullLabel`. */
  value: string | null;
  options: ReadonlyArray<SmartSelectOption>;
  /** Async save handler — receives `null` when the user picks the null
   *  sentinel. Throw or reject to surface an inline error. */
  onSave: (next: string | null) => Promise<void>;
  /** Label for the cleared / unset state. Default: `— Auto / unset —`.
   *  Pass `false` to disable the null option entirely. */
  nullLabel?: string | false;
  /** Class applied to the read-only display label. */
  class?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export default function SmartSelectField({
  value,
  options,
  onSave,
  nullLabel = "— Auto / unset —",
  class: className,
  ariaLabel,
  disabled,
}: SmartSelectFieldProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLabel = value === null
    ? (nullLabel === false ? "—" : nullLabel)
    : (options.find((o) => o.value === value)?.label ?? value);

  const onChange = async (raw: string) => {
    const next = raw === NULL_OPTION ? null : raw;
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span class="inline-flex flex-col gap-1">
        <Select
          value={value ?? NULL_OPTION}
          onValueChange={(v: string) => void onChange(v)}
          open
          onOpenChange={(open: boolean) => {
            if (!open && !saving) setEditing(false);
          }}
        >
          <SelectTrigger
            class={cn(
              "h-7 w-fit min-w-[10rem] gap-1 rounded border border-input bg-background px-2 py-0 text-sm",
            )}
            disabled={saving}
            aria-label={ariaLabel}
          >
            <SelectValue placeholder={nullLabel === false ? "—" : nullLabel} />
          </SelectTrigger>
          <SelectContent>
            {nullLabel !== false && (
              <SelectItem value={NULL_OPTION}>{nullLabel}</SelectItem>
            )}
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && (
          <span class="text-xs text-rose-600" role="alert">{error}</span>
        )}
      </span>
    );
  }

  const isUnset = value === null;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        setError(null);
        setEditing(true);
      }}
      disabled={disabled}
      aria-label={ariaLabel ?? "Edit"}
      class={cn(
        "inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left",
        "hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isUnset && "text-muted-foreground",
        disabled && "cursor-default opacity-70 hover:bg-transparent",
        className,
      )}
    >
      <span class="truncate">{selectedLabel}</span>
    </button>
  );
}
