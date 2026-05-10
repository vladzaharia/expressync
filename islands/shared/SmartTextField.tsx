/**
 * SmartTextField — click-to-edit text field. Linear-style inline edit:
 * the value renders as plain text with a subtle hover affordance; click
 * (or focus via keyboard tab) swaps in an input. Enter or blur saves;
 * Escape cancels and reverts.
 *
 * Save is async (the consumer's `onSave` returns a Promise). On error
 * the field reverts to the prior value and surfaces a small inline
 * message — no toast dependency, so this primitive can be dropped onto
 * any page.
 */

import { type JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { cn } from "@/src/lib/utils/cn.ts";

interface SmartTextFieldProps {
  /** Current value. `null` renders the placeholder. */
  value: string | null;
  /** Placeholder shown when value is null/empty. */
  placeholder?: string;
  /** Async save handler. Throw or reject to surface an error and revert. */
  onSave: (next: string | null) => Promise<void>;
  /** When true, treats whitespace-only values as null on save. */
  trimToNull?: boolean;
  /** Maximum length passed to the underlying input. */
  maxLength?: number;
  /** Class applied to the read-only display text. */
  class?: string;
  /** Class applied to the input when active. */
  inputClass?: string;
  /** Render the read state as a heading (mono / bold / etc) by passing
   *  className overrides. The default is unstyled. */
  ariaLabel?: string;
  /** Disable interaction entirely. */
  disabled?: boolean;
}

export default function SmartTextField({
  value,
  placeholder = "—",
  onSave,
  trimToNull = true,
  maxLength = 200,
  class: className,
  inputClass,
  ariaLabel,
  disabled,
}: SmartTextFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Tracks whether we're committing on blur — we want to avoid double-firing
  // when Enter triggers blur after a successful save.
  const commitingRef = useRef(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    if (disabled || saving) return;
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
    setError(null);
  };

  const commit = async () => {
    if (commitingRef.current) return;
    commitingRef.current = true;
    try {
      const trimmed = draft.trim();
      const next: string | null = trimToNull && trimmed === ""
        ? null
        : (trimToNull ? trimmed : draft);
      const current = value ?? null;
      if (next === current) {
        setEditing(false);
        return;
      }
      setSaving(true);
      try {
        await onSave(next);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDraft(value ?? "");
      } finally {
        setSaving(false);
      }
    } finally {
      commitingRef.current = false;
    }
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <span class="inline-flex flex-col gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={maxLength}
          disabled={saving}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          aria-label={ariaLabel}
          class={cn(
            "rounded border border-input bg-background px-2 py-0.5 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            inputClass,
          )}
        />
        {error && (
          <span class="text-xs text-rose-600" role="alert">{error}</span>
        )}
      </span>
    );
  }

  const hasValue = value !== null && value !== "";
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      aria-label={ariaLabel ?? "Edit"}
      class={cn(
        "group inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left",
        "hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !hasValue && "text-muted-foreground",
        disabled && "cursor-default opacity-70 hover:bg-transparent",
        className,
      )}
    >
      <span class="truncate">
        {hasValue ? value : placeholder}
      </span>
    </button>
  );
}
