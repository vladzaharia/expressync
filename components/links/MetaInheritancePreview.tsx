/**
 * MetaInheritancePreview — read-only "here's what will cascade" panel shown
 * on `/links/new` when the operator selects a meta-tag (OCPP-*) in the
 * TagPicker.
 *
 * Lists the child idTags that will inherit the link at the next sync tick.
 * Pure presentation; no signals or fetches.
 */

import { CornerDownRight, Info, Layers } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";

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
    <Card
      class={cn(
        "border-dashed border-violet-500/40 bg-violet-500/5",
        className,
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers class="size-4 text-violet-500" aria-hidden="true" />
          Inheritance preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
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
                <strong class="text-foreground">
                  {count} child{count === 1 ? "" : "ren"}
                </strong>{" "}
                will follow this link at the next sync tick:
              </>
            )}
        </p>
        {count > 0 && (
          <ul class="flex flex-wrap gap-1.5" aria-label="Inherited child tags">
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
          Inheritance propagates at the next sync; no immediate StEvE write.
        </p>
      </CardContent>
    </Card>
  );
}
