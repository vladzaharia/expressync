/**
 * TagForm — pure-fields tag form for create + edit.
 *
 * Wrapped by `<Form>` (single-step or wizard step 1). Owns the OCPP id-tag,
 * tag-type icon grid, display name, parent picker (meta-tags only), notes,
 * and active flag. Submission is triggered imperatively via the ref —
 * the wrapping chrome calls `formRef.current?.submit()`.
 *
 * In create mode the OCPP tag ID input has an inline "Scan tag" button that
 * mounts a local `<ScanModal>` (callback resolve, no global navigation) so
 * scanning a card auto-fills the field without unmounting the wizard.
 *
 * In edit mode the OCPP tag ID is read-only — the StEvE PK can't be
 * renamed in place. Parent picker is hidden for non-meta tags because the
 * link API auto-sets parent_id_tag from the linked customer.
 */

import { forwardRef } from "preact/compat";
import { useImperativeHandle, useRef } from "preact/hooks";
import { effect, useSignal } from "@preact/signals";
import { Loader2, Radio } from "lucide-preact";
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
import {
  type ParentCandidate,
  ParentTagGrid,
} from "@/components/tags/ParentTagGrid.tsx";
import ScanModal from "@/islands/shared/ScanModal.tsx";

export interface TagFormHandle {
  submit: () => void;
}

export interface TagFormInitial {
  ocppTagPk: number;
  idTag: string;
  displayName: string | null;
  notes: string | null;
  tagType: TagType | null;
  parentIdTag: string | null;
  isActive: boolean;
}

export interface TagFormProps {
  mode: "create" | "edit";
  /** Prefill (always supplied in edit mode). */
  initial?: Partial<TagFormInitial> & { idTag?: string };
  /** Meta-tag candidates for the parent picker (meta-tags only). */
  parentCandidates: ParentCandidate[];
  /** Called when the user blurs the form into an invalid/valid state. */
  onValidityChange?: (valid: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Called on successful persistence. */
  onSuccess?: (
    result: { tagPk: number; idTag: string; isMeta: boolean },
  ) => void;
  /** Surface a fatal API error to the caller (otherwise rendered inline). */
  onError?: (message: string) => void;
}

function TagFormInner(
  props: TagFormProps,
  ref: preact.Ref<TagFormHandle>,
) {
  const { mode, initial, parentCandidates, onValidityChange, onDirtyChange } =
    props;

  const idTag = useSignal(initial?.idTag ?? "");
  const tagType = useSignal<TagType>(
    initial?.tagType ??
      (initial?.idTag ? inferTagType(initial.idTag) : "other"),
  );
  const tagTypeUserEdited = useSignal(initial?.tagType != null);
  const displayName = useSignal(initial?.displayName ?? "");
  const notes = useSignal(initial?.notes ?? "");
  const parentIdTag = useSignal<string | null>(initial?.parentIdTag ?? null);
  const isActive = useSignal(initial?.isActive ?? true);

  const saving = useSignal(false);
  const errorMessage = useSignal<string | null>(null);

  // Scan-tag modal (create mode only).
  const scanOpen = useSignal(false);
  const replaceUndoValue = useSignal<string | null>(null);

  // Wire up validity / dirty notifications. Effect re-fires whenever any
  // tracked signal changes.
  const initialSnapshot = useRef(JSON.stringify({
    idTag: idTag.value,
    tagType: tagType.value,
    displayName: displayName.value,
    notes: notes.value,
    parentIdTag: parentIdTag.value,
    isActive: isActive.value,
  }));
  effect(() => {
    const valid = idTag.value.trim().length > 0;
    onValidityChange?.(valid);

    const current = JSON.stringify({
      idTag: idTag.value,
      tagType: tagType.value,
      displayName: displayName.value,
      notes: notes.value,
      parentIdTag: parentIdTag.value,
      isActive: isActive.value,
    });
    onDirtyChange?.(current !== initialSnapshot.current);
  });

  const meta = isMetaTag(idTag.value);

  const handleIdTagChange = (next: string) => {
    idTag.value = next;
    if (!tagTypeUserEdited.value && next.trim()) {
      tagType.value = inferTagType(next.trim());
    }
  };

  const onScanResult = (
    r: { idTag: string },
  ) => {
    replaceUndoValue.value = idTag.value || null;
    handleIdTagChange(r.idTag);
    // Auto-clear the undo hint after a few seconds.
    setTimeout(() => {
      if (replaceUndoValue.value !== null) replaceUndoValue.value = null;
    }, 4000);
  };

  const undoScan = () => {
    if (replaceUndoValue.value !== null) {
      handleIdTagChange(replaceUndoValue.value);
      replaceUndoValue.value = null;
    }
  };

  const submit = async () => {
    if (saving.value) return;
    const trimmed = idTag.value.trim();
    if (!trimmed) {
      errorMessage.value = "EV Card ID is required.";
      return;
    }
    saving.value = true;
    errorMessage.value = null;

    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/admin/tag/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idTag: trimmed,
            // Parent only meaningful when explicitly chosen on a meta-tag.
            // The auto meta-tag system handles non-meta-tag parents at link time.
            parentIdTag: parentIdTag.value && meta
              ? parentIdTag.value
              : undefined,
            displayName: displayName.value.trim() || undefined,
            notes: notes.value.trim() || undefined,
            tagType: meta ? "other" : tagType.value,
            isActive: isActive.value,
          }),
        });
      } else {
        // Edit — metadata only. idTag and parent are immutable from this
        // form (parent is auto-managed for non-meta tags; meta-tag parent
        // edits go through a future dedicated endpoint).
        if (!initial?.ocppTagPk) {
          throw new Error("Edit mode requires initial.ocppTagPk.");
        }
        res = await fetch("/api/admin/tag/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ocppTagPk: initial.ocppTagPk,
            ocppIdTag: trimmed,
            displayName: displayName.value.trim() || null,
            notes: notes.value.trim() || null,
            tagType: meta ? "other" : tagType.value,
            isActive: isActive.value,
          }),
        });
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof payload.error === "string"
          ? `${payload.error}${payload.detail ? `: ${payload.detail}` : ""}`
          : `Save failed (${res.status})`;
        errorMessage.value = msg;
        props.onError?.(msg);
        return;
      }

      const tagPk = mode === "create"
        ? Number(payload.tagPk ?? 0)
        : (initial?.ocppTagPk ?? 0);
      props.onSuccess?.({ tagPk, idTag: trimmed, isMeta: meta });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorMessage.value = msg;
      props.onError?.(msg);
    } finally {
      saving.value = false;
    }
  };

  useImperativeHandle(ref, () => ({ submit }), []);

  const idTagReadonly = mode === "edit";

  return (
    <div class="space-y-5">
      {/* OCPP tag ID + Scan button */}
      <div class="space-y-1">
        <Label for="tf-id-tag">OCPP EV Card ID *</Label>
        <div class="flex gap-2">
          <Input
            id="tf-id-tag"
            placeholder="e.g. 04A3B2C1D4E5F6"
            value={idTag.value}
            onInput={(e) =>
              handleIdTagChange((e.currentTarget as HTMLInputElement).value)}
            disabled={saving.value || idTagReadonly}
            readOnly={idTagReadonly}
            class={cn("font-mono flex-1", idTagReadonly && "bg-muted")}
          />
          {mode === "create"
            ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => (scanOpen.value = true)}
                disabled={saving.value}
                aria-label="Scan a card to fill the OCPP EV Card ID"
              >
                <Radio class="mr-2 h-4 w-4" />
                Scan card
              </Button>
            )
            : null}
        </div>
        {idTagReadonly
          ? (
            <p class="text-xs text-muted-foreground">
              EV Card ID is permanent — it's the StEvE primary key and cannot change
              in place.
            </p>
          )
          : (
            <p class="text-xs text-muted-foreground">
              Exact string sent by the physical card/keytag/sticker. Use the
              {" "}
              <code>{META_TAG_PREFIX}</code>{" "}
              prefix to create a meta-EV Card (a rollup parent for grouping other
              cards under one customer).
            </p>
          )}
        {replaceUndoValue.value !== null
          ? (
            <p class="text-xs text-muted-foreground">
              Replaced with scanned card.{" "}
              <button
                type="button"
                onClick={undoScan}
                class="underline hover:text-foreground cursor-pointer"
              >
                Undo
              </button>
            </p>
          )
          : null}
      </div>

      {/* Tag type — hidden for meta-tags */}
      {!meta && (
        <div class="space-y-1">
          <Label>EV Card type</Label>
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
                Auto-detected from the EV Card ID. Pick manually to override.
              </p>
            )
            : null}
        </div>
      )}

      {/* Display name */}
      <div class="space-y-1">
        <Label for="tf-display-name">Display name</Label>
        <Input
          id="tf-display-name"
          placeholder="e.g. Vlad's primary card"
          value={displayName.value}
          onInput={(
            e,
          ) => (displayName.value =
            (e.currentTarget as HTMLInputElement).value)}
          disabled={saving.value}
        />
      </div>

      {
        /* Parent picker — meta-tags only. Non-meta tags are auto-parented at
          link-time via the customer's OCPP-{externalId}. */
      }
      {meta && (
        <div class="space-y-1">
          <Label>Parent EV Card (optional)</Label>
          <ParentTagGrid
            candidates={parentCandidates}
            value={parentIdTag.value}
            onChange={(v) => (parentIdTag.value = v)}
            disabled={saving.value}
          />
          <p class="text-xs text-muted-foreground">
            Nest this meta-tag under another rollup. Leave on "No parent" if
            it's a top-level group.
          </p>
        </div>
      )}

      {!meta && (
        <p class="text-xs text-muted-foreground italic">
          Parent tag is set automatically when you link this tag to a customer.
        </p>
      )}

      {/* Notes */}
      <div class="space-y-1">
        <Label for="tf-notes">Notes (optional)</Label>
        <textarea
          id="tf-notes"
          placeholder="e.g. 'Handed to Vlad at install'"
          value={notes.value}
          onInput={(
            e,
          ) => (notes.value = (e.currentTarget as HTMLTextAreaElement).value)}
          disabled={saving.value}
          class="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {/* Active */}
      <div class="flex items-center gap-2">
        <Checkbox
          id="tf-is-active"
          checked={isActive.value}
          onCheckedChange={(v) => (isActive.value = v === true)}
          disabled={saving.value}
        />
        <Label for="tf-is-active" class="text-sm font-normal">
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

      {saving.value
        ? (
          <p class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 class="size-3 animate-spin" />
            Saving…
          </p>
        )
        : null}

      {
        /* Inline scan modal — only when a scan was requested. Avoids the
          global ScanModalHost so its route-resolve doesn't unmount us. */
      }
      {mode === "create"
        ? (
          <ScanModal
            open={scanOpen.value}
            onOpenChange={(v) => (scanOpen.value = v)}
            mode="admin"
            purpose="add-tag"
            resolve={{
              kind: "callback",
              fn: (r) => {
                onScanResult({ idTag: r.idTag });
              },
            }}
          />
        )
        : null}
    </div>
  );
}

const TagForm = forwardRef<TagFormHandle, TagFormProps>(TagFormInner);
export default TagForm;
