/**
 * `/admin/tags/[tagPk]/edit` — standalone edit-tag page.
 *
 * Same form as create, prefilled, with `idTag` immutable. Supports
 * `?next=link` from the wizard's Back button: when present, primary label
 * becomes "Continue" and on success the user lands on
 * `/tags/[pk]/link?fromCreate=1` (preserves the multi-step feel).
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { SidebarLayout } from "../../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../../components/PageCard.tsx";
import { BackAction } from "../../../../components/shared/BackAction.tsx";
import {
  type EnrichedTagRow,
  loadEnrichedTagRoster,
} from "../../../../src/lib/tag-listing.ts";
import { isMetaTag } from "../../../../src/lib/tag-hierarchy.ts";
import { isTagType, type TagType } from "../../../../src/lib/types/tags.ts";
import type { ParentCandidate } from "../../../../components/tags/ParentTagGrid.tsx";
import TagFormWrapper from "../../../../islands/TagFormWrapper.tsx";

interface LoaderData {
  tag: {
    ocppTagPk: number;
    idTag: string;
    displayName: string | null;
    notes: string | null;
    tagType: TagType | null;
    parentIdTag: string | null;
    isActive: boolean;
    isMeta: boolean;
  };
  parentCandidates: ParentCandidate[];
  nextIsLink: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const tagPk = parseInt(ctx.params.tagPk);
    if (!Number.isFinite(tagPk)) return ctx.redirect("/tags");

    const { rows } = await loadEnrichedTagRoster();
    const row = rows.find((r) => r.ocppTagPk === tagPk);
    if (!row) {
      // Fall back to mapping-only (StEvE may be down).
      const [mapping] = await db
        .select()
        .from(schema.userMappings)
        .where(eq(schema.userMappings.steveOcppTagPk, tagPk))
        .limit(1);
      if (!mapping) return ctx.redirect("/tags");
      const fallbackTagType = mapping.tagType && isTagType(mapping.tagType)
        ? mapping.tagType
        : null;
      const fallbackTag: LoaderData["tag"] = {
        ocppTagPk: tagPk,
        idTag: mapping.steveOcppIdTag,
        displayName: mapping.displayName,
        notes: mapping.notes,
        tagType: fallbackTagType,
        parentIdTag: null,
        isActive: mapping.isActive ?? true,
        isMeta: isMetaTag(mapping.steveOcppIdTag),
      };
      return {
        data: {
          tag: fallbackTag,
          parentCandidates: [],
          nextIsLink: ctx.url.searchParams.get("next") === "link",
        } satisfies LoaderData,
      };
    }

    const parentCandidates: ParentCandidate[] = rows
      .filter((r) => r.isMeta)
      .filter((r) => r.idTag !== row.idTag) // can't parent self
      .map((r): ParentCandidate => ({
        idTag: r.idTag,
        ocppTagPk: r.ocppTagPk,
        tagType: r.tagType,
        displayName: r.displayName,
        isMeta: r.isMeta,
        hasLagoCustomer: r.hasLagoCustomer,
      }));

    return {
      data: {
        tag: rowToLoaderTag(row),
        parentCandidates,
        nextIsLink: ctx.url.searchParams.get("next") === "link",
      } satisfies LoaderData,
    };
  },
});

function rowToLoaderTag(row: EnrichedTagRow): LoaderData["tag"] {
  return {
    ocppTagPk: row.ocppTagPk,
    idTag: row.idTag,
    displayName: row.displayName,
    notes: row.notes,
    tagType: row.tagType,
    parentIdTag: row.parentIdTag,
    isActive: row.isActive,
    isMeta: row.isMeta,
  };
}

export default define.page<typeof handler>(function EditTagPage(
  { data, url, state },
) {
  const { tag, parentCandidates, nextIsLink } = data;
  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      accentColor="cyan"
      actions={<BackAction href={`/tags/${tag.ocppTagPk}`} />}
    >
      <PageCard
        title="Edit tag"
        description="Update the tag's metadata. The OCPP tag ID can't be renamed."
        colorScheme="cyan"
      >
        <TagFormWrapper
          mode="edit"
          initial={{
            ocppTagPk: tag.ocppTagPk,
            idTag: tag.idTag,
            displayName: tag.displayName,
            notes: tag.notes,
            tagType: tag.tagType,
            parentIdTag: tag.parentIdTag,
            isActive: tag.isActive,
          }}
          parentCandidates={parentCandidates}
          cancelHref={`/tags/${tag.ocppTagPk}`}
          nextIsLink={nextIsLink}
        />
      </PageCard>
    </SidebarLayout>
  );
});
