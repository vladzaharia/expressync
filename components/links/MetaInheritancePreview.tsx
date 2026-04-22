/**
 * MetaInheritancePreview — read-only "here's what will cascade" panel shown
 * on `/links/new` when the operator selects a meta-tag (OCPP-*) in the
 * TagPicker.
 *
 * Renders inline inside the `MappingForm` (which itself lives inside a
 * `SectionCard` now), so this uses a lightweight bordered sub-panel rather
 * than another full SectionCard — prevents nested card chrome while still
 * carrying the violet accent wash the rest of the linking UI uses.
 */

import { CornerDownRight, Info, Layers } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  parentIdTag: string;
  childIdTags: string[];
  class?: string;
}

export function MetaInheritancePreview(
  { parentIdTag, childIdTags, class: className }: Props,
) {
  const count = childIdTags.length;

  return (
    <section
      aria-labelledby="inheritance-preview-title"
      class={cn(
        "rounded-lg border border-violet-500/30 bg-violet-500/5",
        className,
      )}
    >
      <header class="flex items-center justify-between gap-3 border-b border-violet-500/20 px-4 py-2.5">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400"
            aria-hidden="true"
          >
            <Layers class="size-4" />
          </span>
          <h4
            id="inheritance-preview-title"
            class="text-sm font-semibold truncate"
          >
            Inheritance preview
          </h4>
        </div>
        {count > 0 && (
          <Badge variant="outline" class="font-normal">
            {count} child{count === 1 ? "" : "ren"}
          </Badge>
        )}
      </header>

      <div class="space-y-3 px-4 py-3 text-sm">
        <p class="text-muted-foreground">
          {count === 0
            ? (
              <>
                <code class="font-mono text-foreground">{parentIdTag}</code>
                {" "}
                has no child tags today. New children created under it later
                will inherit this link at the next sync.
              </>
            )
            : (
              <>
                These tags will follow the link at the next sync tick:
              </>
            )}
        </p>

        {count > 0 && (
          <ul
            class="flex flex-wrap gap-1.5"
            aria-label="Inherited child tags"
          >
            {childIdTags.map((idTag) => (
              <li
                key={idTag}
                class="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs"
              >
                <CornerDownRight
                  class="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
                <code class="font-mono">{idTag}</code>
              </li>
            ))}
          </ul>
        )}

        <p class="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info class="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          Inheritance propagates at the next sync — no immediate StEvE write.
        </p>
      </div>
    </section>
  );
}
