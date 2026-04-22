import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { getAllChildTags } from "../../../src/lib/tag-hierarchy.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  isTagType,
  TAG_TYPES,
  type TagType,
} from "../../../src/lib/types/tags.ts";

export const handler = define.handlers({
  // Get all mappings
  async GET(_ctx) {
    try {
      const mappings = await db.select().from(schema.userMappings);
      return new Response(JSON.stringify(mappings), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to fetch mappings", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch mappings" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  // Create new mapping
  // When creating a mapping for a parent tag, automatically creates mappings for all child tags
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const {
        ocppTagId,
        ocppTagPk,
        lagoCustomerId,
        lagoSubscriptionId,
        isActive,
      } = body;

      // Subscription is now optional - will be auto-selected at sync time if not provided
      if (!ocppTagId || !ocppTagPk || !lagoCustomerId) {
        return new Response(
          JSON.stringify({
            error:
              "Missing required fields (ocppTagId, ocppTagPk, lagoCustomerId)",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Phase I: validate optional tag_type against TAG_TYPES allowlist.
      // Accept both snake_case (`tag_type`) and camelCase (`tagType`) keys for
      // flexibility; default to "other" if unset.
      const rawTagType = body.tag_type ?? body.tagType;
      let tagType: TagType = "other";
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
        tagType = rawTagType;
      }

      // Fetch all OCPP tags to check for children + verify the parent tag
      // actually exists in StEvE.
      const allTags = await steveClient.getOcppTags();
      const childTags = getAllChildTags(ocppTagId, allTags);

      // Guarantee tag/mapping consistency: if the client gave us an
      // ocppTagPk that StEvE doesn't know about (stale dropdown, scanner
      // race, etc.), create the tag in StEvE before inserting the mapping
      // row. Prefer an exact match by pk; fall back to idTag to heal the
      // common case where the client had only the idTag. Without this,
      // we'd silently insert a dangling user_mappings row.
      let effectiveTagPk: number = ocppTagPk;
      let steveTag = allTags.find((t) => t.ocppTagPk === ocppTagPk);
      if (!steveTag) {
        steveTag = allTags.find((t) => t.idTag === ocppTagId);
      }
      if (!steveTag) {
        logger.info(
          "API",
          `Tag ${ocppTagId} not found in StEvE; creating it there before inserting mapping`,
        );
        try {
          const created = await steveClient.createOcppTag(ocppTagId, {});
          effectiveTagPk = created.ocppTagPk;
        } catch (err) {
          logger.error(
            "API",
            "Failed to auto-create StEvE tag during mapping creation",
            err as Error,
          );
          return new Response(
            JSON.stringify({
              error:
                `Tag ${ocppTagId} does not exist in StEvE and could not be created: ${
                  err instanceof Error ? err.message : String(err)
                }`,
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
      } else if (steveTag.ocppTagPk !== ocppTagPk) {
        // Client had a stale pk but the idTag is real. Use the authoritative pk
        // so the mapping row references the live StEvE record.
        effectiveTagPk = steveTag.ocppTagPk;
      }

      // Create mapping for the parent tag
      const [parentMapping] = await db
        .insert(schema.userMappings)
        .values({
          steveOcppTagPk: effectiveTagPk,
          steveOcppIdTag: ocppTagId,
          lagoCustomerExternalId: lagoCustomerId,
          lagoSubscriptionExternalId: lagoSubscriptionId || null,
          isActive: isActive ?? true,
          tagType,
        })
        .returning();

      // Create mappings for all child tags with the same Lago customer/subscription
      const childMappings = [];
      for (const childTag of childTags) {
        try {
          const [childMapping] = await db
            .insert(schema.userMappings)
            .values({
              steveOcppTagPk: childTag.ocppTagPk,
              steveOcppIdTag: childTag.idTag,
              lagoCustomerExternalId: lagoCustomerId,
              lagoSubscriptionExternalId: lagoSubscriptionId || null,
              isActive: isActive ?? true,
              // Children inherit the parent's type by default.
              tagType,
            })
            .returning();
          childMappings.push(childMapping);
        } catch (error) {
          // Skip if child mapping already exists
          logger.warn(
            "API",
            `Failed to create mapping for child tag ${childTag.idTag}`,
            error as Error,
          );
        }
      }

      return new Response(
        JSON.stringify({
          parentMapping,
          childMappings,
          totalCreated: 1 + childMappings.length,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to create mapping", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to create mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  // Update mapping
  // When updating a parent tag mapping, also updates all child tag links
  async PUT(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const id = parseInt(url.searchParams.get("id") || "");

      if (!id) {
        return new Response(JSON.stringify({ error: "Missing ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await ctx.req.json();
      const updates: Partial<typeof schema.userMappings.$inferInsert> = {};

      if (body.lagoCustomerExternalId !== undefined) {
        updates.lagoCustomerExternalId = body.lagoCustomerExternalId;
      }
      if (body.lagoSubscriptionExternalId !== undefined) {
        updates.lagoSubscriptionExternalId = body.lagoSubscriptionExternalId;
      }
      if (body.isActive !== undefined) updates.isActive = body.isActive;

      // Phase P2: billing_tier flip (inline PATCH from LinkingDangerZone).
      // Validate against the same allowlist enforced by the DB CHECK
      // constraint so a garbage value gets a 400 rather than a 5xx round-trip.
      if (body.billingTier !== undefined && body.billingTier !== null) {
        if (body.billingTier !== "standard" && body.billingTier !== "comped") {
          return new Response(
            JSON.stringify({
              error: "Invalid billingTier. Must be 'standard' or 'comped'.",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        updates.billingTier = body.billingTier;
      }

      // Phase I: allow updating tag_type; validate against TAG_TYPES allowlist.
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
        updates.tagType = rawTagType;
      }

      // Get the current mapping to find its tag
      const [currentMapping] = await db
        .select()
        .from(schema.userMappings)
        .where(eq(schema.userMappings.id, id));

      if (!currentMapping) {
        return new Response(JSON.stringify({ error: "Mapping not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update the parent mapping
      const [mapping] = await db
        .update(schema.userMappings)
        .set(updates)
        .where(eq(schema.userMappings.id, id))
        .returning();

      // If Lago customer/subscription changed, update child mappings too
      if (
        body.lagoCustomerExternalId !== undefined ||
        body.lagoSubscriptionExternalId !== undefined
      ) {
        const allTags = await steveClient.getOcppTags();
        const childTags = getAllChildTags(
          currentMapping.steveOcppIdTag,
          allTags,
        );

        for (const childTag of childTags) {
          await db
            .update(schema.userMappings)
            .set({
              lagoCustomerExternalId: body.lagoCustomerExternalId ??
                currentMapping.lagoCustomerExternalId,
              lagoSubscriptionExternalId: body.lagoSubscriptionExternalId ??
                currentMapping.lagoSubscriptionExternalId,
            })
            .where(eq(schema.userMappings.steveOcppTagPk, childTag.ocppTagPk));
        }
      }

      return new Response(JSON.stringify(mapping), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to update mapping", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to update mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  // Delete mapping
  // When deleting a parent tag mapping, also deletes all child tag links
  async DELETE(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const id = parseInt(url.searchParams.get("id") || "");

      if (!id) {
        return new Response(JSON.stringify({ error: "Missing ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get the current mapping to find its tag
      const [currentMapping] = await db
        .select()
        .from(schema.userMappings)
        .where(eq(schema.userMappings.id, id));

      if (!currentMapping) {
        return new Response(JSON.stringify({ error: "Mapping not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Delete the parent mapping
      await db.delete(schema.userMappings).where(
        eq(schema.userMappings.id, id),
      );

      // Delete child mappings
      const allTags = await steveClient.getOcppTags();
      const childTags = getAllChildTags(currentMapping.steveOcppIdTag, allTags);

      for (const childTag of childTags) {
        await db
          .delete(schema.userMappings)
          .where(eq(schema.userMappings.steveOcppTagPk, childTag.ocppTagPk));
      }

      return new Response(
        JSON.stringify({
          success: true,
          deletedCount: 1 + childTags.length,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to delete mapping", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to delete mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
