/**
 * Hierarchy (parent + children) for `/tags/[tagPk]`. For non-meta tags this
 * section is conditional on `hasAny` — rendered as-needed below Issued Cards.
 * For meta-tags it is promoted above Issued Cards and always renders (even if
 * empty) so the operator can confirm the rollup has no children yet.
 */

import { CornerDownRight, Layers, Link2Off } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { TagChip } from "@/components/tags/TagChip.tsx";

export interface RelationTag {
  idTag: string;
  /** StEvE primary key — when null the child/parent tag isn't mapped locally yet. */
  tagPk: number | null;
  tagType: string | null;
  displayName: string | null;
  /** Only relevant for children — drives muted styling on the chip. */
  hasLagoCustomer: boolean;
}

interface Props {
  isMeta: boolean;
  parent: RelationTag | null;
  childTags: RelationTag[];
}

export function TagRelationsSection({ isMeta, parent, childTags }: Props) {
  const emptyChildren = childTags.length === 0;

  return (
    <SectionCard
      title="Hierarchy"
      icon={Layers}
      accent="cyan"
      actions={childTags.length > 0
        ? (
          <Badge variant="outline" class="font-normal">
            {childTags.length} child{childTags.length === 1 ? "" : "ren"}
          </Badge>
        )
        : undefined}
    >
      <div class="space-y-4">
        {/* Parent block */}
        <div>
          <div class="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Parent
          </div>
          {parent
            ? (
              <div class="flex flex-wrap items-center gap-2">
                {parent.tagPk !== null
                  ? (
                    <TagChip
                      idTag={parent.idTag}
                      tagPk={parent.tagPk}
                      tagType={parent.tagType}
                      displayName={parent.displayName}
                      hasLagoCustomer={parent.hasLagoCustomer}
                    />
                  )
                  : (
                    <TagChip
                      idTag={parent.idTag}
                      tagPk={0}
                      tagType={parent.tagType}
                      displayName={parent.displayName}
                      hasLagoCustomer={parent.hasLagoCustomer}
                      href={null}
                    />
                  )}
              </div>
            )
            : (
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <Link2Off class="h-3.5 w-3.5" aria-hidden="true" />
                <span>No parent — this tag is top-level.</span>
              </div>
            )}
        </div>

        {/* Children block */}
        <div>
          <div class="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <CornerDownRight class="h-3.5 w-3.5" aria-hidden="true" />
            <span>Children</span>
          </div>
          {emptyChildren
            ? (
              <div class="text-xs text-muted-foreground">
                {isMeta
                  ? "No children yet — child tags inherit from a meta-tag via StEvE's `parentIdTag` field."
                  : "None."}
              </div>
            )
            : (
              <div class="flex flex-wrap gap-2">
                {childTags.map((c) =>
                  c.tagPk !== null
                    ? (
                      <TagChip
                        key={c.idTag}
                        idTag={c.idTag}
                        tagPk={c.tagPk}
                        tagType={c.tagType}
                        displayName={c.displayName}
                        hasLagoCustomer={c.hasLagoCustomer}
                        isChild
                      />
                    )
                    : (
                      <TagChip
                        key={c.idTag}
                        idTag={c.idTag}
                        tagPk={0}
                        tagType={c.tagType}
                        displayName={c.displayName}
                        hasLagoCustomer={c.hasLagoCustomer}
                        isChild
                        href={null}
                      />
                    )
                )}
              </div>
            )}
        </div>
      </div>
    </SectionCard>
  );
}
