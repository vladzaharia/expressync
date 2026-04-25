/**
 * POST /api/tag/create
 *
 * Create a brand-new OCPP tag in StEvE and seed a bare user_mappings row
 * with optional metadata. Independent of Lago linkage — the operator can
 * link it later via /links.
 *
 * Body: { idTag, parentIdTag?, displayName?, tagType?, notes?, isActive? }
 * Returns: { ok, tagPk, mappingId, idTag }
 */

import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import { isTagType } from "../../../../src/lib/types/tags.ts";

const log = logger.child("CreateTag");

export const handler = define.handlers({
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const b = body as Record<string, unknown>;
    const idTag = typeof b.idTag === "string" ? b.idTag.trim() : "";
    if (idTag === "") return json(400, { error: "invalid_id_tag" });

    const parentIdTag = typeof b.parentIdTag === "string" &&
        b.parentIdTag.trim() !== ""
      ? b.parentIdTag.trim()
      : undefined;

    const displayName = typeof b.displayName === "string" &&
        b.displayName.trim() !== ""
      ? b.displayName.trim()
      : null;
    const notes = typeof b.notes === "string" && b.notes.trim() !== ""
      ? b.notes.trim()
      : null;
    const isActive = typeof b.isActive === "boolean" ? b.isActive : true;
    const tagType: string = isTagType(b.tagType) ? b.tagType : "other";

    // 1. Create in StEvE first — if this fails we never insert a ghost row
    //    locally that references a non-existent ocppTagPk.
    let tagPk: number;
    try {
      const result = await steveClient.createOcppTag(idTag, {
        parentIdTag,
        note: notes ?? undefined,
      });
      tagPk = result.ocppTagPk;
    } catch (err) {
      log.error("StEvE create failed", {
        idTag,
        error: err instanceof Error ? err.message : String(err),
      });
      return json(502, {
        error: "steve_create_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Insert the mapping row with metadata. Not fatal if it fails — the
    //    operator can come back later and edit via /tags/[tagPk].
    try {
      const [row] = await db
        .insert(schema.userMappings)
        .values({
          steveOcppTagPk: tagPk,
          steveOcppIdTag: idTag,
          displayName,
          notes,
          isActive,
          tagType,
          // Mirror SteVe's parent_id_tag locally so the inline sync's
          // full-PUT doesn't clobber it. Migration 0031 added the column.
          steveParentIdTag: parentIdTag ?? null,
        })
        .returning({ id: schema.userMappings.id });
      log.info("Tag created", {
        idTag,
        tagPk,
        mappingId: row.id,
      });
      return json(201, { ok: true, tagPk, mappingId: row.id, idTag });
    } catch (err) {
      log.error("Mapping insert failed after StEvE create", {
        idTag,
        tagPk,
        error: err instanceof Error ? err.message : String(err),
      });
      return json(500, {
        error: "mapping_insert_failed",
        tagPk,
        idTag,
      });
    }
  },
});

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
