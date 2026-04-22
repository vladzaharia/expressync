/**
 * POST /api/tag/metadata
 *
 * Upsert *metadata-only* fields on a `user_mappings` row keyed by the
 * StEvE tag primary key. Creates a bare row if none exists so callers
 * don't have to pre-link a tag to a Lago customer before editing its
 * display name / type / notes / active flag.
 *
 * Body: { ocppTagPk, ocppIdTag, displayName?, tagType?, notes?, isActive? }
 *
 * Deliberately does NOT touch linking fields (lagoCustomerExternalId,
 * lagoSubscriptionExternalId). Use `/api/tag/link` or `/api/tag` for those.
 *
 * Meta-tags (OCPP-*) are allowed through — the UI prevents editing type on
 * them, but if a client forces a tag_type value the server accepts it; the
 * meta-tag-ness is a render-time derivation, not a persisted category.
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import { isTagType } from "../../../../src/lib/types/tags.ts";

const log = logger.child("TagMetadata");

export const handler = define.handlers({
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonError(400, "invalid_json");
    }

    const b = body as Record<string, unknown>;
    const ocppTagPk = Number(b.ocppTagPk);
    const ocppIdTag = typeof b.ocppIdTag === "string" ? b.ocppIdTag : null;

    if (!Number.isInteger(ocppTagPk) || ocppTagPk <= 0) {
      return jsonError(400, "invalid_ocpp_tag_pk");
    }
    if (!ocppIdTag || ocppIdTag.trim() === "") {
      return jsonError(400, "invalid_ocpp_id_tag");
    }

    // Pull optional metadata fields. Any key that's undefined is left as-is
    // on update (i.e. partial patch semantics); null explicitly clears.
    const displayName = b.displayName === undefined
      ? undefined
      : (b.displayName === null || b.displayName === ""
        ? null
        : String(b.displayName));
    const notes = b.notes === undefined
      ? undefined
      : (b.notes === null || b.notes === "" ? null : String(b.notes));
    const isActive = typeof b.isActive === "boolean" ? b.isActive : undefined;

    let tagType: string | undefined;
    if (b.tagType !== undefined) {
      if (!isTagType(b.tagType)) {
        return jsonError(400, "invalid_tag_type");
      }
      tagType = b.tagType;
    }

    try {
      const [existing] = await db
        .select()
        .from(schema.userMappings)
        .where(eq(schema.userMappings.steveOcppTagPk, ocppTagPk))
        .limit(1);

      if (existing) {
        // Partial update — include only keys that were sent.
        const patch: Partial<typeof schema.userMappings.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (displayName !== undefined) patch.displayName = displayName;
        if (notes !== undefined) patch.notes = notes;
        if (isActive !== undefined) patch.isActive = isActive;
        if (tagType !== undefined) patch.tagType = tagType;
        // Also rescue a stale idTag if StEvE renamed the tag (same pk).
        if (existing.steveOcppIdTag !== ocppIdTag) {
          patch.steveOcppIdTag = ocppIdTag;
        }

        const [updated] = await db
          .update(schema.userMappings)
          .set(patch)
          .where(eq(schema.userMappings.id, existing.id))
          .returning();

        log.info("Updated tag metadata", {
          mappingId: existing.id,
          ocppTagPk,
          fieldsUpdated: Object.keys(patch).filter((k) => k !== "updatedAt"),
        });
        return json(200, { ok: true, mapping: updated });
      }

      // No existing mapping — create a bare one with just metadata fields.
      const [created] = await db
        .insert(schema.userMappings)
        .values({
          steveOcppTagPk: ocppTagPk,
          steveOcppIdTag: ocppIdTag,
          displayName: displayName ?? null,
          notes: notes ?? null,
          isActive: isActive ?? true,
          tagType: tagType ?? "other",
        })
        .returning();

      log.info("Created tag metadata row", {
        mappingId: created.id,
        ocppTagPk,
      });
      return json(201, { ok: true, mapping: created });
    } catch (err) {
      log.error("Failed to upsert tag metadata", {
        ocppTagPk,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonError(500, "db_error");
    }
  },
});

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
