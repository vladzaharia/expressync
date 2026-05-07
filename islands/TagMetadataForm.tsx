import { useSignal } from "@preact/signals";
import { Check, Layers, Loader2 } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import {
  TAG_TYPES,
  type TagType,
  tagTypeLabels,
  USER_SELECTABLE_TAG_TYPES,
} from "@/src/lib/types/tags.ts";
import { isMetaTag } from "@/src/lib/tag-hierarchy.ts";

interface Props {
  /** StEvE primary key (immutable). */
  ocppTagPk: number;
  /** The OCPP id-tag string (shown read-only). */
  ocppIdTag: string;
  /** Existing metadata to seed the form from. */
  initial?: {
    displayName: string | null;
    notes: string | null;
    tagType: string | null;
    isActive: boolean | null;
  };
}

import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";

function coerceTagType(value: string | null | undefined): TagType {
  return value && (TAG_TYPES as readonly string[]).includes(value)
    ? (value as TagType)
    : "ev_card";
}

/**
 * Slim tag-metadata form used on `/tags/[tagPk]`. Owns *only* metadata
 * fields: display name, type, notes, active flag. Deliberately does not
 * touch Lago linkage (that lives on `/links/[id]` via `MappingForm`).
 *
 * "Managed" tag categories are read-only: meta-tags (`META-*` /
 * legacy `OCPP-*`) and app-mediated device tags (`OCPP-D-*`). Both
 * are minted automatically by the server (`ensureCustomerMetaTag` /
 * `ensureDeviceTag`) so any human edit would diverge the on-card
 * label from the actual tag origin. The form switches every input to
 * read-only and hides the Save button when `managed` is true.
 */
export default function TagMetadataForm({
  ocppTagPk,
  ocppIdTag,
  initial,
}: Props) {
  const meta = isMetaTag(ocppIdTag);
  // App / device tags share the OCPP-D- prefix that `ensureDeviceTag`
  // mints. They're auto-managed for the same reason as meta — edits
  // would drift from the tag origin.
  const isAppDeviceTag = ocppIdTag.startsWith("OCPP-D-");
  const initialTagType = coerceTagType(initial?.tagType);
  const managed = meta || isAppDeviceTag || initialTagType === "app" ||
    initialTagType === "meta";

  const displayName = useSignal(initial?.displayName ?? "");
  const notes = useSignal(initial?.notes ?? "");
  const tagType = useSignal<TagType>(initialTagType);
  const isActive = useSignal(initial?.isActive ?? true);

  const saving = useSignal(false);
  const errorMessage = useSignal<string | null>(null);
  const savedTick = useSignal(false);

  const onSave = async () => {
    if (saving.value) return;
    saving.value = true;
    errorMessage.value = null;
    savedTick.value = false;
    try {
      const res = await fetch("/api/admin/tag/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocppTagPk,
          ocppIdTag,
          displayName: displayName.value.trim() === ""
            ? null
            : displayName.value.trim(),
          notes: notes.value.trim() === "" ? null : notes.value.trim(),
          tagType: tagType.value,
          isActive: isActive.value,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorMessage.value = typeof payload.error === "string"
          ? payload.error
          : `Save failed (${res.status})`;
        return;
      }
      savedTick.value = true;
      setTimeout(() => (savedTick.value = false), 2000);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err);
    } finally {
      saving.value = false;
    }
  };

  return (
    <div class="space-y-5">
      {/* OCPP id + meta-tag badge */}
      <div class="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <Label class="text-xs uppercase text-muted-foreground">
          OCPP EV Card
        </Label>
        <code class="font-mono text-sm">{ocppIdTag}</code>
        {meta
          ? (
            <span
              class="ml-auto flex items-center gap-1.5 rounded-md border border-dashed border-input bg-background px-2 py-1 text-xs text-muted-foreground"
              title="OCPP-* EV Cards are hierarchy rollups, not physical cards."
            >
              <Layers class="h-3.5 w-3.5" />
              Meta-EV Card
            </span>
          )
          : null}
      </div>

      {/* Display name */}
      <div class="space-y-1">
        <Label for="tm-display-name">Display name</Label>
        <Input
          id="tm-display-name"
          placeholder={meta ? "e.g. Vlad (group)" : "e.g. Vlad's primary card"}
          value={displayName.value}
          onInput={(
            e,
          ) => (displayName.value =
            (e.currentTarget as HTMLInputElement).value)}
          disabled={saving.value || managed}
        />
        <p class="text-xs text-muted-foreground">
          {meta
            ? "Label for the roll-up grouping shown in the admin UI."
            : "Friendly label shown in our portal; never exposed to the customer."}
        </p>
      </div>

      {/* Tag type — disabled for managed (meta + app/device) tags. */}
      <div class="space-y-1">
        <Label>EV Card type</Label>
        {managed
          ? (
            <div class="flex items-center gap-3 rounded-md border border-dashed border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Layers class="h-4 w-4" />
              <span>
                {meta
                  ? "Auto-classified as Meta-EV Card"
                  : "Auto-classified as App (device-issued)"}
              </span>
            </div>
          )
          : (
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {USER_SELECTABLE_TAG_TYPES.map((t) => {
                const Icon = tagTypeIcons[t];
                const selected = tagType.value === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => (tagType.value = t)}
                    disabled={saving.value || managed}
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
          )}
      </div>

      {/* Notes */}
      <div class="space-y-1">
        <Label for="tm-notes">Notes (optional)</Label>
        <textarea
          id="tm-notes"
          placeholder="Free-text notes for ops (e.g. 'replacement for lost card')."
          value={notes.value}
          onInput={(
            e,
          ) => (notes.value = (e.currentTarget as HTMLTextAreaElement).value)}
          disabled={saving.value || managed}
          class="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {/* isActive */}
      <div class="flex items-center gap-2">
        <Checkbox
          id="tm-is-active"
          checked={isActive.value}
          onCheckedChange={(checked) => (isActive.value = checked === true)}
          disabled={saving.value || managed}
        />
        <Label for="tm-is-active" class="text-sm font-normal">
          Active (EV Card may authorize at a charger)
        </Label>
      </div>

      {errorMessage.value
        ? (
          <div class="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
            {errorMessage.value}
          </div>
        )
        : null}

      {managed && (
        <div class="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs text-violet-700 dark:text-violet-300">
          This tag is auto-managed by the system{" "}
          ({meta ? "customer parent meta-tag" : "app-issued device tag"}). Edits
          would diverge the on-card label from the actual origin, so the form is
          read-only here.
        </div>
      )}

      {!managed && (
        <div class="flex items-center justify-end gap-2">
          {savedTick.value
            ? (
              <span class="flex items-center gap-1 text-sm text-emerald-500">
                <Check class="h-4 w-4" /> Saved
              </span>
            )
            : null}
          <Button onClick={onSave} disabled={saving.value}>
            {saving.value
              ? <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              : null}
            Save metadata
          </Button>
        </div>
      )}
    </div>
  );
}
