/**
 * TagsFilterBar — interactive search + multi-select filter bar for `/tags`.
 *
 * STATUS: Scaffold only. Polaris Express runs at friends-and-family scale
 * (<30 tags), so the full filter UI is deferred. The scaffold exists so:
 *   - The `TagsFilterState` shape is authoritative across the server loader
 *     and the future island,
 *   - Auto-open logic (once `rows.length > 30`) has a target to mount, and
 *   - URL-param filters already wired on the server (see `coerceFilterState`
 *     in `routes/tags/index.tsx`) can round-trip through the UI without a
 *     second pass.
 *
 * The server should only render this island when the URL already carries
 * filter params (`?q=…`, `?linked=…`, `?active=…`, `?meta=…`, or `?types=…`)
 * — otherwise leave it unmounted. The current implementation
 * renders a minimal "Filters active — clear" placeholder so operators who
 * land on a deep-linked filtered view have a visible exit.
 */

import { useSignal } from "@preact/signals";
import { X } from "lucide-preact";
import type { TagType } from "@/src/lib/types/tags.ts";
import { Button } from "@/components/ui/button.tsx";

export type TriState = "any" | "yes" | "no";

export interface TagsFilterState {
  q: string;
  linked: TriState;
  active: TriState;
  meta: TriState;
  /**
   * Serializable set of tag types selected. Server loader echoes this as
   * `Set<TagType>`; the island stores it as a plain array for JSON-friendly
   * signal hydration and converts at the boundary.
   */
  types: Set<TagType>;
}

export interface TagsFilterStateSerialized {
  q: string;
  linked: TriState;
  active: TriState;
  meta: TriState;
  types: TagType[];
}

interface Props {
  /** Hydrated filter state from the URL. */
  initial: TagsFilterStateSerialized;
  /**
   * Total tag count (pre-filter). Used by future auto-open logic to decide
   * whether the full UI should default to expanded; currently unused but
   * passed so the shape is stable.
   */
  totalCount?: number;
}

/**
 * Minimal scaffold implementation. Future iterations will add:
 *   - A debounced `<input>` bound to `state.q` writing back to the URL.
 *   - `ToggleGroup`-driven tri-state controls for linked/active/meta.
 *   - A multi-select popover for `types`.
 * For now we just render the "clear filters" escape hatch.
 */
export default function TagsFilterBar({ initial }: Props) {
  // Kept as a signal to anchor the future expand/collapse logic without
  // breaking the serialization contract once full UI lands.
  const _state = useSignal<TagsFilterStateSerialized>(initial);
  const hasAnyFilter = hasActiveFilter(_state.value);

  if (!hasAnyFilter) return null;

  return (
    <div class="mb-4 flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-sm">
      <span class="text-muted-foreground">
        Filter active — showing a subset of tags.
      </span>
      <Button variant="outline" size="sm" asChild>
        <a href="/tags">
          <X class="mr-1 size-3.5" aria-hidden="true" />
          Clear filters
        </a>
      </Button>
    </div>
  );
}

function hasActiveFilter(s: TagsFilterStateSerialized): boolean {
  return (
    s.q.trim().length > 0 ||
    s.linked !== "any" ||
    s.active !== "any" ||
    s.meta !== "any" ||
    s.types.length > 0
  );
}
