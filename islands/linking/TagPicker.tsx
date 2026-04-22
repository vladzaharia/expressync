/**
 * TagPicker — owns the OCPP-tag side of the linking form.
 *
 * Responsibilities:
 *   - Fetch `/api/tag` (all OCPP tags in StEvE) and `/api/tag/link` (existing
 *     user_mappings) so we can annotate availability.
 *   - Render three entry points for creating/finding a tag:
 *       1. Tap to add (opens the shared `TapToAddModal` island — NFC path).
 *       2. A scrollable chip grid of unlinked tags (click-to-select).
 *       3. An external link to `/tags/new` for operator-driven creation.
 *   - Emit `onChange(idTag, ocppTagPk)` whenever the selection changes.
 *
 * Selection display collapses the picker to a single "selected" chip with a
 * `Change` button; clearing returns to the chip grid.
 *
 * This island intentionally does NOT create OCPP tags inline — per the plan,
 * the `/links/new` flow sends operators to `/tags/new` instead, keeping
 * tag-metadata ownership on the Tags page.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  AlertTriangle,
  ExternalLink,
  Layers,
  Package,
  Radio,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import TapToAddModal from "@/islands/TapToAddModal.tsx";
import { isMetaTag } from "@/src/lib/tag-hierarchy.ts";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import { type TagType, tagTypeLabels } from "@/src/lib/types/tags.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";

export interface OcppTag {
  id: string;
  ocppTagPk: number;
  parentIdTag: string | null;
}

export interface ExistingMapping {
  id: number;
  steveOcppIdTag: string;
}

interface Props {
  /** Current selected idTag (empty string = unselected). */
  value: string | null;
  /** Current selected ocppTagPk (0 = unselected). */
  valuePk: number;
  /** Fired whenever the selection changes. Pass `""`, `0` to clear. */
  onChange: (idTag: string, ocppTagPk: number) => void;
  /** When set, the picker filters this mapping's own tag back into the
   *  candidate list (edit mode — otherwise it would be hidden as "linked"). */
  mappingId?: number;
  /** Enable the Tap-to-add NFC entry point. Defaults to true. */
  allowTap?: boolean;
  /** Optional label override; defaults to "Select OCPP Tag". */
  label?: string;
}

function coerceTagType(idTag: string): TagType {
  // Inference purely for icon rendering inside the picker; server doesn't
  // care what we think the type is here — that's owned by /tags/[tagPk].
  if (/^[0-9A-F]{14}$/i.test(idTag)) return "ev_card";
  if (/^[0-9A-F]{8}$/i.test(idTag)) return "keytag";
  if (/^QR-/.test(idTag)) return "guest_qr";
  if (/^APP-/.test(idTag)) return "app";
  return "other";
}

export default function TagPicker(props: Props) {
  const {
    value,
    valuePk: _valuePk,
    onChange,
    mappingId,
    allowTap = true,
    label,
  } = props;

  const ocppTags = useSignal<OcppTag[]>([]);
  const existingMappings = useSignal<ExistingMapping[]>([]);
  const showTapToAdd = useSignal(false);
  const search = useSignal("");
  const loading = useSignal(true);
  const loadError = useSignal<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      loading.value = true;
      loadError.value = null;
      try {
        const [tagsRes, mappingsRes] = await Promise.all([
          fetch("/api/tag"),
          fetch("/api/tag/link"),
        ]);
        const tagsData = await tagsRes.json();
        const mappingsData = await mappingsRes.json();
        if (cancelled) return;
        if (Array.isArray(tagsData)) ocppTags.value = tagsData;
        if (Array.isArray(mappingsData)) existingMappings.value = mappingsData;
      } catch (err) {
        if (cancelled) return;
        loadError.value = "Failed to load tags";
        console.error(err);
      } finally {
        if (!cancelled) loading.value = false;
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const getAllChildTagsLocal = (parentId: string): OcppTag[] => {
    const out: OcppTag[] = [];
    const visited = new Set<string>([parentId]);
    const walk = (id: string) => {
      for (const t of ocppTags.value) {
        if (t.parentIdTag !== id || visited.has(t.id)) continue;
        visited.add(t.id);
        out.push(t);
        walk(t.id);
      }
    };
    walk(parentId);
    return out;
  };

  const hasMappedParent = (tag: OcppTag): string | null => {
    if (!tag.parentIdTag) return null;
    const parentMapping = existingMappings.value.find(
      (m) => m.steveOcppIdTag === tag.parentIdTag,
    );
    if (parentMapping) return tag.parentIdTag;
    const parent = ocppTags.value.find((t) => t.id === tag.parentIdTag);
    if (parent) return hasMappedParent(parent);
    return null;
  };

  const availableTags = useComputed<OcppTag[]>(() => {
    const q = search.value.trim().toLowerCase();
    return ocppTags.value.filter((tag) => {
      if (mappingId && tag.id === value) return true;
      const hasDirect = existingMappings.value.some(
        (m) => m.steveOcppIdTag === tag.id,
      );
      if (hasDirect && tag.id !== value) return false;
      if (!q) return true;
      return tag.id.toLowerCase().includes(q);
    });
  });

  const tagInfoMap = useComputed(() => {
    const map = new Map<string, {
      tag: OcppTag;
      childCount: number;
      mappedParent: string | null;
    }>();
    for (const tag of availableTags.value) {
      const children = getAllChildTagsLocal(tag.id);
      map.set(tag.id, {
        tag,
        childCount: children.length,
        mappedParent: hasMappedParent(tag),
      });
    }
    return map;
  });

  // --- Render: a selected value collapses into a summary card ---
  if (value) {
    const meta = isMetaTag(value);
    const tt = coerceTagType(value);
    const Icon = meta ? Layers : tagTypeIcons[tt];
    return (
      <div className="space-y-2">
        <Label>{label ?? "Select OCPP Tag"}</Label>
        <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg shrink-0",
                  meta
                    ? "border border-dashed border-input bg-background text-muted-foreground"
                    : tagTypeBgClass[tt],
                )}
              >
                {meta
                  ? <Layers className="size-4" />
                  : <Icon size="sm" class={tagTypeTextClass[tt]} />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold font-mono truncate">{value}</h3>
                <p className="text-xs text-muted-foreground">
                  {meta ? "Meta-tag" : tagTypeLabels[tt]}
                </p>
              </div>
            </div>
            {!mappingId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange("", 0)}
                className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
              >
                Change
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label>{label ?? "Select OCPP Tag"}</Label>
        <div className="flex items-center gap-2 flex-wrap">
          {allowTap && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (showTapToAdd.value = true)}
              className="border-purple-500 text-purple-600 hover:bg-purple-500/10 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-400"
            >
              <Radio className="size-4 mr-1" aria-hidden="true" />
              Tap to add
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            asChild
          >
            <a href="/tags/new" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 mr-1" aria-hidden="true" />
              <span>Create new tag</span>
              <span className="sr-only">(opens in new tab)</span>
            </a>
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search tags…"
        value={search.value}
        onInput={(e) => (search.value = (e.target as HTMLInputElement).value)}
        className="font-mono"
      />

      {loadError.value && (
        <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm border border-destructive/20">
          {loadError.value}
        </div>
      )}

      {loading.value
        ? (
          <div className="bg-muted rounded-lg p-4 text-center text-sm text-muted-foreground">
            Loading tags…
          </div>
        )
        : availableTags.value.length === 0
        ? (
          <div className="bg-muted rounded-lg p-4 text-center text-sm text-muted-foreground">
            {search.value
              ? "No matching unlinked tags."
              : "No available tags to link. All tags already have a mapping."}
          </div>
        )
        : (
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1"
            role="listbox"
            aria-label="Unlinked OCPP tags"
          >
            {availableTags.value.map((tag) => {
              const info = tagInfoMap.value.get(tag.id);
              const meta = isMetaTag(tag.id);
              const tt = coerceTagType(tag.id);
              const Icon = meta ? Layers : tagTypeIcons[tt];
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onChange(tag.id, tag.ocppTagPk)}
                  className="text-left border-2 border-border hover:border-violet-500/70 rounded-lg p-3 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg shrink-0",
                        meta
                          ? "border border-dashed border-input bg-background text-muted-foreground"
                          : tagTypeBgClass[tt],
                      )}
                      aria-hidden="true"
                    >
                      {meta
                        ? <Layers className="size-4" />
                        : <Icon size="sm" class={tagTypeTextClass[tt]} />}
                    </div>
                    <h3 className="font-medium font-mono text-sm truncate flex-1">
                      {tag.id}
                    </h3>
                    {meta && (
                      <span className="text-[10px] uppercase tracking-wide text-violet-600 dark:text-violet-400 font-semibold">
                        META
                      </span>
                    )}
                  </div>
                  {info && info.childCount > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-violet-500 font-medium flex items-center gap-1">
                        <Package className="size-3" aria-hidden="true" />
                        {info.childCount}{" "}
                        child{info.childCount > 1 ? "ren" : ""}
                      </p>
                    </div>
                  )}
                  {info && info.mappedParent && (
                    <div className="mt-2 pt-2 border-t border-yellow-500/30 bg-yellow-500/10 -mx-3 -mb-3 px-3 py-2 rounded-b-lg">
                      <p className="text-xs text-yellow-600 font-medium flex items-center gap-1">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        Parent mapped — will override
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

      {allowTap && (
        <TapToAddModal
          open={showTapToAdd.value}
          onOpenChange={(open) => (showTapToAdd.value = open)}
          onTagDetected={(tagId) => {
            const existing = ocppTags.value.find((t) => t.id === tagId);
            if (existing) {
              onChange(existing.id, existing.ocppTagPk);
            } else {
              // Tag doesn't exist yet — send the operator to /tags/new with
              // the scanned idTag prefilled. The plan forbids inline create
              // on /links/new; /tags/new owns tag creation.
              globalThis.location.href = `/tags/new?idTag=${
                encodeURIComponent(tagId)
              }`;
            }
          }}
        />
      )}
    </div>
  );
}
