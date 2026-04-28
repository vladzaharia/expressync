/**
 * Enriched tag roster — single source of truth for "every OCPP tag we know
 * about, joined with our local user_mappings metadata + computed flags".
 *
 * Extracted from `routes/admin/tags/index.tsx` so the new-tag and edit-tag
 * flows can source parent candidates from the same shape without
 * re-implementing the join.
 */

import { db } from "@/src/db/index.ts";
import * as schema from "@/src/db/schema.ts";
import { steveClient } from "@/src/lib/steve-client.ts";
import { isMetaTag } from "@/src/lib/tag-hierarchy.ts";
import { isTagType, type TagType } from "@/src/lib/types/tags.ts";

export interface EnrichedTagRow {
  ocppTagPk: number;
  idTag: string;
  parentIdTag: string | null;
  parentTagPk: number | null;
  mappingId: number | null;
  displayName: string | null;
  tagType: TagType | null;
  notes: string | null;
  isActive: boolean;
  hasMapping: boolean;
  hasLagoCustomer: boolean;
  isMeta: boolean;
  childCount: number;
}

export interface EnrichedTagRoster {
  rows: EnrichedTagRow[];
  steveFetchFailed: boolean;
}

/**
 * Fetch the StEvE OCPP tag roster + our `user_mappings` rows in parallel and
 * return the enriched join. Tolerates StEvE failure (returns an empty roster
 * with `steveFetchFailed: true`).
 */
export async function loadEnrichedTagRoster(): Promise<EnrichedTagRoster> {
  let steveFetchFailed = false;
  const [ocppTags, mappings] = await Promise.all([
    steveClient.getOcppTags().catch((err) => {
      console.error("[tag-listing] StEvE fetch failed:", err);
      steveFetchFailed = true;
      return [] as Awaited<ReturnType<typeof steveClient.getOcppTags>>;
    }),
    db.select().from(schema.userMappings),
  ]);

  const mappingByTagPk = new Map<number, schema.UserMapping>();
  for (const m of mappings) mappingByTagPk.set(m.steveOcppTagPk, m);

  const tagPkByIdTag = new Map<string, number>();
  for (const t of ocppTags) tagPkByIdTag.set(t.idTag, t.ocppTagPk);

  const childCountByParentIdTag = new Map<string, number>();
  for (const t of ocppTags) {
    if (t.parentIdTag) {
      childCountByParentIdTag.set(
        t.parentIdTag,
        (childCountByParentIdTag.get(t.parentIdTag) ?? 0) + 1,
      );
    }
  }

  const rows: EnrichedTagRow[] = ocppTags.map((t) => {
    const mapping = mappingByTagPk.get(t.ocppTagPk);
    const tagTypeRaw = mapping?.tagType ?? null;
    const tagType: TagType | null = tagTypeRaw && isTagType(tagTypeRaw)
      ? tagTypeRaw
      : null;
    const isMeta = isMetaTag(t.idTag);
    const parentIdTag = t.parentIdTag ?? null;
    const parentTagPk = parentIdTag
      ? tagPkByIdTag.get(parentIdTag) ?? null
      : null;
    return {
      ocppTagPk: t.ocppTagPk,
      idTag: t.idTag,
      parentIdTag,
      parentTagPk,
      mappingId: mapping?.id ?? null,
      displayName: mapping?.displayName ?? null,
      tagType,
      notes: mapping?.notes ?? null,
      isActive: mapping?.isActive ?? true,
      hasMapping: Boolean(mapping),
      hasLagoCustomer: Boolean(mapping?.lagoCustomerExternalId),
      isMeta,
      childCount: childCountByParentIdTag.get(t.idTag) ?? 0,
    };
  });

  return { rows, steveFetchFailed };
}
