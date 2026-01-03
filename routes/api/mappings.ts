import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { steveClient } from "../../src/lib/steve-client.ts";
import { getAllChildTags } from "../../src/lib/tag-hierarchy.ts";

export const handler = define.handlers({
  // Get all mappings
  async GET(_ctx) {
    const mappings = await db.select().from(schema.userMappings);
    return new Response(JSON.stringify(mappings), {
      headers: { "Content-Type": "application/json" },
    });
  },

  // Create new mapping
  // When creating a mapping for a parent tag, automatically creates mappings for all child tags
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const { ocppTagId, ocppTagPk, lagoCustomerId, lagoSubscriptionId, isActive, displayName, notes } = body;

      // Subscription is now optional - will be auto-selected at sync time if not provided
      if (!ocppTagId || !ocppTagPk || !lagoCustomerId) {
        return new Response(
          JSON.stringify({ error: "Missing required fields (ocppTagId, ocppTagPk, lagoCustomerId)" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Fetch all OCPP tags to check for children
      const allTags = await steveClient.getOcppTags();
      const childTags = getAllChildTags(ocppTagId, allTags);

      // Create mapping for the parent tag
      const [parentMapping] = await db
        .insert(schema.userMappings)
        .values({
          steveOcppTagPk: ocppTagPk,
          steveOcppIdTag: ocppTagId,
          lagoCustomerExternalId: lagoCustomerId,
          lagoSubscriptionExternalId: lagoSubscriptionId || null,
          displayName: displayName || null,
          notes: notes || null,
          isActive: isActive ?? true,
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
              displayName: `${displayName || ocppTagId} (child of ${ocppTagId})`,
              notes: `Auto-created from parent tag ${ocppTagId}. ${notes || ''}`.trim(),
              isActive: isActive ?? true,
            })
            .returning();
          childMappings.push(childMapping);
        } catch (error) {
          // Skip if child mapping already exists
          console.warn(`Failed to create mapping for child tag ${childTag.idTag}:`, error);
        }
      }

      return new Response(JSON.stringify({
        parentMapping,
        childMappings,
        totalCreated: 1 + childMappings.length,
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Failed to create mapping:", error);
      return new Response(
        JSON.stringify({ error: "Failed to create mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  // Update mapping
  // When updating a parent tag mapping, also updates all child tag mappings
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
      if (body.displayName !== undefined) updates.displayName = body.displayName;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.isActive !== undefined) updates.isActive = body.isActive;

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
      if (body.lagoCustomerExternalId !== undefined || body.lagoSubscriptionExternalId !== undefined) {
        const allTags = await steveClient.getOcppTags();
        const childTags = getAllChildTags(currentMapping.steveOcppIdTag, allTags);

        for (const childTag of childTags) {
          await db
            .update(schema.userMappings)
            .set({
              lagoCustomerExternalId: body.lagoCustomerExternalId ?? currentMapping.lagoCustomerExternalId,
              lagoSubscriptionExternalId: body.lagoSubscriptionExternalId ?? currentMapping.lagoSubscriptionExternalId,
            })
            .where(eq(schema.userMappings.steveOcppTagPk, childTag.ocppTagPk));
        }
      }

      return new Response(JSON.stringify(mapping), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Failed to update mapping:", error);
      return new Response(
        JSON.stringify({ error: "Failed to update mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  // Delete mapping
  // When deleting a parent tag mapping, also deletes all child tag mappings
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

      return new Response(JSON.stringify({
        success: true,
        deletedCount: 1 + childTags.length,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Failed to delete mapping:", error);
      return new Response(
        JSON.stringify({ error: "Failed to delete mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

