import { useSignal } from "@preact/signals";
import { Check, Loader2 } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import {
  inferTagType,
  TAG_TYPES,
  type TagType,
  tagTypeLabels,
} from "@/src/lib/types/tags.ts";
import { isMetaTag, META_TAG_PREFIX } from "@/src/lib/tag-hierarchy.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";

interface Props {
  /** Prefilled id-tag (from scanner or URL query). */
  prefilledIdTag?: string;
  /** Known parent tag candidates from StEvE, used in the optional picker. */
  parentCandidates?: Array<{ idTag: string }>;
}

/**
 * Creates a brand-new OCPP tag in StEvE plus a bare user_mappings row.
 * Metadata only — Lago linking happens later on /links. Redirects to
 * /tags/{newTagPk} on success.
 */
export default function NewTagForm(
  { prefilledIdTag, parentCandidates }: Props,
) {
  const idTag = useSignal(prefilledIdTag ?? "");
  const parentIdTag = useSignal("");
  const displayName = useSignal("");
  const notes = useSignal("");
  const tagType = useSignal<TagType>(
    prefilledIdTag ? inferTagType(prefilledIdTag) : "other",
  );
  const tagTypeUserEdited = useSignal(false);
  const isActive = useSignal(true);

  const saving = useSignal(false);
  const errorMessage = useSignal<string | null>(null);

  const meta = isMetaTag(idTag.value);

  const handleIdTagChange = (next: string) => {
    idTag.value = next;
    if (!tagTypeUserEdited.value && next.trim()) {
      tagType.value = inferTagType(next.trim());
    }
  };

  const handleSubmit = async () => {
    if (saving.value) return;
    const trimmed = idTag.value.trim();
    if (!trimmed) {
      errorMessage.value = "Tag ID is required.";
      return;
    }
    saving.value = true;
    errorMessage.value = null;
    try {
      const res = await fetch("/api/admin/tag/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idTag: trimmed,
          parentIdTag: parentIdTag.value.trim() || undefined,
          displayName: displayName.value.trim() || undefined,
          notes: notes.value.trim() || undefined,
          tagType: meta ? "other" : tagType.value,
          isActive: isActive.value,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorMessage.value = typeof payload.error === "string"
          ? `${payload.error}${payload.detail ? `: ${payload.detail}` : ""}`
          : `Create failed (${res.status})`;
        return;
      }
      if (typeof payload.tagPk === "number") {
        globalThis.location.href = `/tags/${payload.tagPk}`;
      } else {
        globalThis.location.href = "/tags";
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err);
    } finally {
      saving.value = false;
    }
  };

  return (
    <div class="space-y-5">
      <div class="space-y-1">
        <Label for="nt-id-tag">OCPP tag ID *</Label>
        <Input
          id="nt-id-tag"
          placeholder="e.g. 04A3B2C1D4E5F6"
          value={idTag.value}
          onInput={(e) =>
            handleIdTagChange((e.currentTarget as HTMLInputElement).value)}
          disabled={saving.value}
          class="font-mono"
        />
        <p class="text-xs text-muted-foreground">
          Exact string sent by the physical card/keytag/sticker. Use the{" "}
          <code>{META_TAG_PREFIX}</code>{" "}
          prefix to create a meta-tag (a rollup parent for grouping other tags
          under one customer).
        </p>
      </div>

      {!meta && (
        <div class="space-y-1">
          <Label>Tag type</Label>
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
            {TAG_TYPES.map((t) => {
              const Icon = tagTypeIcons[t];
              const selected = tagType.value === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    tagType.value = t;
                    tagTypeUserEdited.value = true;
                  }}
                  disabled={saving.value}
                  aria-pressed={selected}
                  class={cn(
                    "flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <div
                    class={cn(
                      "flex size-8 items-center justify-center rounded-lg",
                      tagTypeBgClass[t],
                    )}
                  >
                    <Icon size="sm" class={tagTypeTextClass[t]} />
                  </div>
                  <span>{tagTypeLabels[t]}</span>
                </button>
              );
            })}
          </div>
          {!tagTypeUserEdited.value && idTag.value.trim()
            ? (
              <p class="text-xs text-muted-foreground">
                Auto-detected from the tag ID. Pick manually to override.
              </p>
            )
            : null}
        </div>
      )}

      <div class="space-y-1">
        <Label for="nt-display-name">Display name</Label>
        <Input
          id="nt-display-name"
          placeholder="e.g. Vlad's primary card"
          value={displayName.value}
          onInput={(
            e,
          ) => (displayName.value =
            (e.currentTarget as HTMLInputElement).value)}
          disabled={saving.value}
        />
      </div>

      <div class="space-y-1">
        <Label for="nt-parent">Parent tag (optional)</Label>
        <Input
          id="nt-parent"
          placeholder={`e.g. ${META_TAG_PREFIX}VLAD`}
          value={parentIdTag.value}
          onInput={(
            e,
          ) => (parentIdTag.value =
            (e.currentTarget as HTMLInputElement).value)}
          disabled={saving.value}
          list={parentCandidates && parentCandidates.length > 0
            ? "nt-parent-options"
            : undefined}
          class="font-mono"
        />
        {parentCandidates && parentCandidates.length > 0
          ? (
            <datalist id="nt-parent-options">
              {parentCandidates.map((p) => (
                <option value={p.idTag} key={p.idTag} />
              ))}
            </datalist>
          )
          : null}
        <p class="text-xs text-muted-foreground">
          Link this tag under an existing tag so it inherits billing setup.
          Leave blank if none.
        </p>
      </div>

      <div class="space-y-1">
        <Label for="nt-notes">Notes (optional)</Label>
        <textarea
          id="nt-notes"
          placeholder="e.g. 'Handed to Vlad at install'"
          value={notes.value}
          onInput={(
            e,
          ) => (notes.value = (e.currentTarget as HTMLTextAreaElement).value)}
          disabled={saving.value}
          class="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div class="flex items-center gap-2">
        <Checkbox
          id="nt-is-active"
          checked={isActive.value}
          onCheckedChange={(v) => (isActive.value = v === true)}
          disabled={saving.value}
        />
        <Label for="nt-is-active" class="text-sm font-normal">
          Active (tag may authorize at a charger immediately)
        </Label>
      </div>

      {errorMessage.value
        ? (
          <div class="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
            {errorMessage.value}
          </div>
        )
        : null}

      <div class="flex items-center justify-end gap-2">
        <a
          href="/tags"
          class="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </a>
        <Button onClick={handleSubmit} disabled={saving.value}>
          {saving.value
            ? <Loader2 class="mr-2 h-4 w-4 animate-spin" />
            : <Check class="mr-2 h-4 w-4" />}
          Create tag
        </Button>
      </div>
    </div>
  );
}
