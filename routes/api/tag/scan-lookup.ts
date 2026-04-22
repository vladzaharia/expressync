/**
 * POST /api/tag/scan-lookup
 *
 * Given a freshly-scanned OCPP id-tag string, decide where to send the
 * operator: the tag's details page if StEvE already knows it, or the
 * new-tag creation page if it's unknown.
 *
 * Body: { idTag: string }
 * Returns: {
 *   exists: boolean,
 *   tagPk?: number,
 *   hasMapping?: boolean,
 *   // NEW: the numeric `user_mappings.id` when a mapping exists (null
 *   // when the tag is known to StEvE but unmapped). Callers that want
 *   // to deep-link to `/links/<id>` need this to avoid a second lookup.
 *   mappingId?: number | null,
 * }
 */

import { eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ScanLookup");

export const handler = define.handlers({
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const idTag = typeof (body as { idTag?: unknown }).idTag === "string"
      ? (body as { idTag: string }).idTag.trim()
      : "";
    if (idTag === "") {
      return json(400, { error: "invalid_id_tag" });
    }

    try {
      const steveTags = await steveClient.getOcppTags();
      const steveMatch = steveTags.find((t) => t.idTag === idTag);

      if (!steveMatch) {
        log.info("Scan lookup: unknown tag", { idTag });
        return json(200, { exists: false });
      }

      const [mapping] = await db
        .select({ id: schema.userMappings.id })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.steveOcppTagPk, steveMatch.ocppTagPk))
        .limit(1);

      const mappingId = mapping?.id ?? null;

      log.info("Scan lookup: existing tag", {
        idTag,
        tagPk: steveMatch.ocppTagPk,
        hasMapping: Boolean(mapping),
        mappingId,
      });

      return json(200, {
        exists: true,
        tagPk: steveMatch.ocppTagPk,
        hasMapping: Boolean(mapping),
        mappingId,
      });
    } catch (err) {
      log.error("Scan lookup failed", {
        idTag,
        error: err instanceof Error ? err.message : String(err),
      });
      return json(500, { error: "lookup_failed" });
    }
  },
});

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
