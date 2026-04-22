/**
 * TagPickerCombobox — accessible combobox for selecting an OCPP idTag.
 *
 * Unlike `/islands/linking/TagPicker.tsx` (grid of unlinked-for-mapping
 * candidates), this picker is designed for the Remote Actions panel:
 *   - Shows ALL OCPP tags (no unlinked filter; any valid tag works).
 *   - Surfaces `displayName`, active/inactive state, and Lago customer hint
 *     inline so operators don't have to context-switch.
 *   - Warns inline when the selected tag is inactive — StEvE will refuse
 *     the transaction anyway, and a pre-flight warning beats a server-side
 *     rejection round-trip.
 *
 * Implementation notes:
 *   - Keyboard nav: Arrow Up/Down, Enter, Esc, type-ahead through the
 *     filter input.
 *   - A plain `<input type="text">` opens a listbox popover; we render it
 *     as a relative/absolute duo rather than use a portal to keep the
 *     dialog-inside semantics simple.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { AlertTriangle, Check, ChevronDown, Search } from "lucide-preact";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface TagPickerComboboxProps {
  value: string;
  onChange: (idTag: string) => void;
  label?: string;
  helpText?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}

interface TagRow {
  id: string;
  ocppTagPk: number;
  parentIdTag: string | null;
  displayName: string | null;
  lagoCustomerExternalId: string | null;
  isActive: boolean;
}

export function TagPickerCombobox(props: TagPickerComboboxProps) {
  const {
    value,
    onChange,
    label = "OCPP ID tag",
    helpText,
    disabled,
    required,
    autoFocus,
  } = props;

  const [tags, setTags] = useState<TagRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tag");
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data)) setTags(data as TagRow[]);
        else setLoadError("Unexpected response from /api/tag");
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load tags",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (autoFocus && !disabled) {
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [autoFocus, disabled]);

  const selectedTag = tags.find((t) => t.id === value) ?? null;
  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags.slice(0, 50);
    return tags.filter((t) =>
      t.id.toLowerCase().includes(q) ||
      (t.displayName ?? "").toLowerCase().includes(q) ||
      (t.lagoCustomerExternalId ?? "").toLowerCase().includes(q)
    ).slice(0, 50);
  })();

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[activeIdx]) {
        onChange(filtered[activeIdx].id);
        setOpen(false);
        setQuery("");
      } else {
        setOpen(true);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const showInactiveWarning = selectedTag && !selectedTag.isActive;

  return (
    <div class="flex flex-col gap-1">
      {label && (
        <Label class="text-xs">
          {label}
          {required && <span class="text-rose-500">*</span>}
        </Label>
      )}

      <div class="relative">
        <div
          class={cn(
            "flex items-center gap-2 rounded-md border border-input bg-background px-2",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        >
          <Search class="size-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls="tag-picker-listbox"
            aria-autocomplete="list"
            disabled={disabled}
            class="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            placeholder={selectedTag
              ? `${selectedTag.id}${
                selectedTag.displayName ? ` — ${selectedTag.displayName}` : ""
              }`
              : "Search OCPP tag…"}
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onInput={(e) => {
              setQuery((e.currentTarget as HTMLInputElement).value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <ChevronDown
            class="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>

        {open && !disabled && (
          <ul
            ref={listRef}
            id="tag-picker-listbox"
            role="listbox"
            class="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border bg-popover shadow-md"
          >
            {loading && (
              <li class="px-3 py-2 text-xs text-muted-foreground">
                Loading tags…
              </li>
            )}
            {loadError && (
              <li class="px-3 py-2 text-xs text-rose-600">{loadError}</li>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <li class="px-3 py-2 text-xs text-muted-foreground">
                No tags match "{query}"
              </li>
            )}
            {filtered.map((t, idx) => {
              const isSelected = t.id === value;
              const isActive = idx === activeIdx;
              return (
                <li
                  key={t.id}
                  role="option"
                  aria-selected={isSelected}
                  // Use onMouseDown (fires before input blur) so clicks
                  // register before the listbox unmounts.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(t.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  class={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                    isActive && "bg-accent",
                    isSelected && "bg-accent/60",
                  )}
                >
                  <Check
                    class={cn(
                      "size-3.5 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <span class="font-mono text-xs">{t.id}</span>
                  {t.displayName && (
                    <span class="truncate text-xs text-muted-foreground">
                      — {t.displayName}
                    </span>
                  )}
                  <span class="ml-auto flex items-center gap-1">
                    {t.lagoCustomerExternalId && (
                      <Badge variant="outline" class="text-[10px] font-mono">
                        {t.lagoCustomerExternalId}
                      </Badge>
                    )}
                    <Badge
                      variant={t.isActive ? "secondary" : "outline"}
                      class={cn(
                        "text-[10px]",
                        !t.isActive &&
                          "border-amber-500/40 text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {t.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedTag && !open && (
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span class="font-mono text-xs">{selectedTag.id}</span>
          {selectedTag.displayName && <span>· {selectedTag.displayName}</span>}
          <Badge
            variant={selectedTag.isActive ? "secondary" : "outline"}
            class={cn(
              "text-[10px]",
              !selectedTag.isActive &&
                "border-amber-500/40 text-amber-600 dark:text-amber-400",
            )}
          >
            {selectedTag.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      )}

      {showInactiveWarning && (
        <div
          role="alert"
          class="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle class="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            This tag is marked <strong>inactive</strong>{" "}
            — StEvE will reject the transaction.
          </span>
        </div>
      )}

      {helpText && <p class="text-[11px] text-muted-foreground">{helpText}</p>}
    </div>
  );
}

export default TagPickerCombobox;
