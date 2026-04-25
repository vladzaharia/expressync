import { define } from "../../../../utils.ts";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import { isTagType, TAG_TYPES } from "../../../../src/lib/types/tags.ts";
import { db } from "../../../../src/db/index.ts";
import { userMappings } from "../../../../src/db/schema.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const hasPaginationParams = url.searchParams.has("limit") ||
        url.searchParams.has("skip");
      const skipRaw = parseInt(url.searchParams.get("skip") || "0", 10);
      const skip = isNaN(skipRaw) || skipRaw < 0 ? 0 : skipRaw;
      const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
      const limit = isNaN(limitRaw) ? 25 : Math.max(1, Math.min(100, limitRaw));

      // Use the properly configured StEvE client
      const tags = await steveClient.getOcppTags();

      // Wave A5: fetch all user_mappings in one extra query and zip by
      // `steveOcppTagPk` so the picker UI can render display info alongside
      // the StEvE-owned tag list without a full rewrite to DB-only.
      const mappings = await db
        .select({
          steveOcppTagPk: userMappings.steveOcppTagPk,
          displayName: userMappings.displayName,
          lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
          isActive: userMappings.isActive,
        })
        .from(userMappings);

      const byOcppTagPk = new Map<
        number,
        {
          displayName: string | null;
          lagoCustomerExternalId: string | null;
          isActive: boolean | null;
        }
      >();
      for (const m of mappings) {
        byOcppTagPk.set(m.steveOcppTagPk, {
          displayName: m.displayName,
          lagoCustomerExternalId: m.lagoCustomerExternalId,
          isActive: m.isActive,
        });
      }

      // Transform to format for the UI, including parent information and
      // picker-friendly fields from user_mappings. New fields are OPTIONAL
      // extensions — existing consumers ignore unknown keys.
      const simplifiedTags = tags.map((tag) => {
        const mapping = byOcppTagPk.get(tag.ocppTagPk);
        const isActive = mapping
          ? mapping.isActive === true
          : tag.maxActiveTransactionCount !== 0;
        return {
          id: tag.idTag,
          ocppTagPk: tag.ocppTagPk,
          parentIdTag: tag.parentIdTag,
          displayName: mapping?.displayName ?? null,
          lagoCustomerExternalId: mapping?.lagoCustomerExternalId ?? null,
          isActive,
        };
      });

      // StEvE returns the full set in one call, so we paginate post-fetch
      // in JS. Back-compat: legacy callers (TagPickerCombobox + others)
      // expect a bare array, so we only switch to the wrapped pagination
      // shape when the caller opts in by passing `?limit=` or `?skip=`.
      if (!hasPaginationParams) {
        return new Response(JSON.stringify(simplifiedTags), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const total = simplifiedTags.length;
      const page = simplifiedTags.slice(skip, skip + limit);
      return new Response(
        JSON.stringify({ rows: page, total, limit, skip }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch OCPP tags", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch OCPP tags" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const { idTag, parentIdTag, maxActiveTransactionCount } = body;

      if (!idTag || typeof idTag !== "string") {
        return new Response(
          JSON.stringify({ error: "idTag is required and must be a string" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Validate idTag format (alphanumeric, max 20 chars per OCPP spec)
      if (!/^[a-zA-Z0-9_-]{1,20}$/.test(idTag)) {
        return new Response(
          JSON.stringify({
            error:
              "idTag must be 1-20 alphanumeric characters (including _ and -)",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Phase I: validate optional tag_type if provided (forward-compatible —
      // this route creates StEvE OCPP tags, not user_mappings, so the field
      // is not persisted here, but we reject garbage early).
      const rawTagType = body.tag_type ?? body.tagType;
      if (rawTagType !== undefined && rawTagType !== null) {
        if (!isTagType(rawTagType)) {
          return new Response(
            JSON.stringify({
              error: `Invalid tag_type. Must be one of: ${
                TAG_TYPES.join(", ")
              }`,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
      }

      const result = await steveClient.createOcppTag(idTag, {
        parentIdTag,
        maxActiveTransactionCount,
      });

      return new Response(
        JSON.stringify({
          id: idTag,
          ocppTagPk: result.ocppTagPk,
          parentIdTag: parentIdTag || null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("API", "Failed to create OCPP tag", error as Error);
      const message = error instanceof Error
        ? error.message
        : "Failed to create OCPP tag";
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
