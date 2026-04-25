import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import { getAllChildTags } from "../../../../src/lib/tag-hierarchy.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import {
  isTagType,
  TAG_TYPES,
  type TagType,
} from "../../../../src/lib/types/tags.ts";
import {
  ProvisionerError,
  resolveOrCreateCustomerAccount,
} from "../../../../src/services/customer-account-provisioner.ts";
import { syncSingleTagToSteve } from "../../../../src/services/tag-sync.service.ts";
import { bulkCancelFutureReservationsForUser } from "../../../../src/services/reservation.service.ts";
import { logAuthEvent } from "../../../../src/lib/audit.ts";

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
  // When creating a mapping for a parent tag, automatically creates mappings
  // for all child tags. Wrapped in a single transaction so customer-account
  // auto-provisioning + parent + child inserts either all succeed or all fail.
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
      // actually exists in StEvE. (Outside the transaction — read-only and
      // talks to StEvE; we don't want long network calls inside the tx.)
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

      // Wrap the customer-account resolution + parent insert + child inserts
      // in a single transaction so a failure rolls back ALL the DB state.
      // The StEvE-side tag creation above is already committed and not
      // rolled back; that's fine — a dangling StEvE tag with no mapping is
      // recoverable on the next admin click.
      let parentMapping: schema.UserMapping | null = null;
      const childMappings: schema.UserMapping[] = [];
      let resolvedAccount: {
        userId: string;
        /** Null when Lago customer had no email — see provisioner. */
        email: string | null;
        autoCreated: boolean;
        reused: boolean;
      } | null = null;

      try {
        await db.transaction(async (tx) => {
          // Resolve or create the customer account FIRST so the mapping rows
          // can carry user_id from creation. Throws ProvisionerError on the
          // documented 4xx/5xx cases — caught below and translated to HTTP.
          const account = await resolveOrCreateCustomerAccount(
            tx,
            lagoCustomerId,
          );
          resolvedAccount = {
            userId: account.userId,
            email: account.email,
            autoCreated: account.created,
            reused: account.reused,
          };

          // Create mapping for the parent tag with the resolved userId.
          const [parent] = await tx
            .insert(schema.userMappings)
            .values({
              steveOcppTagPk: effectiveTagPk,
              steveOcppIdTag: ocppTagId,
              lagoCustomerExternalId: lagoCustomerId,
              lagoSubscriptionExternalId: lagoSubscriptionId || null,
              isActive: isActive ?? true,
              tagType,
              userId: account.userId,
            })
            .returning();
          parentMapping = parent;

          // Cascade child tags with the same userId.
          for (const childTag of childTags) {
            try {
              const [childMapping] = await tx
                .insert(schema.userMappings)
                .values({
                  steveOcppTagPk: childTag.ocppTagPk,
                  steveOcppIdTag: childTag.idTag,
                  lagoCustomerExternalId: lagoCustomerId,
                  lagoSubscriptionExternalId: lagoSubscriptionId || null,
                  isActive: isActive ?? true,
                  // Children inherit the parent's type by default.
                  tagType,
                  userId: account.userId,
                })
                .returning();
              childMappings.push(childMapping);
            } catch (error) {
              // Skip if child mapping already exists. Logged for visibility
              // but doesn't fail the whole transaction.
              logger.warn(
                "API",
                `Failed to create mapping for child tag ${childTag.idTag}`,
                error as Error,
              );
            }
          }
        });
      } catch (err) {
        if (err instanceof ProvisionerError) {
          logger.warn("API", "Account provisioner rejected mapping create", {
            code: err.code,
            status: err.status,
            lagoCustomerId,
          });
          return new Response(
            JSON.stringify({
              error: err.message,
              code: err.code,
            }),
            {
              status: err.status,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw err;
      }

      // Inline StEvE sync — best-effort per affected mapping. Any failure
      // emits an admin notification via syncSingleTagToSteve; we keep the
      // 201 because the source-of-truth DB state is correct and the
      // background sync will reconcile.
      if (parentMapping) {
        await syncSingleTagToSteve(parentMapping);
      }
      for (const cm of childMappings) {
        await syncSingleTagToSteve(cm);
      }

      return new Response(
        JSON.stringify({
          parentMapping,
          childMappings,
          totalCreated: 1 + childMappings.length,
          account: resolvedAccount,
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
  // When updating a parent tag mapping, also updates all child tag links.
  // Wrapped in a transaction. If `lagoCustomerExternalId` changes, this is
  // gated behind `?confirm_reassign=true` because reassignment moves
  // historical session visibility from one customer account to another.
  async PUT(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const id = parseInt(url.searchParams.get("id") || "");
      const confirmReassign = url.searchParams.get("confirm_reassign") ===
        "true";

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

      // Get the current mapping to find its tag (outside the tx so we can
      // gate the reassign check before opening a write transaction).
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

      // Detect a Lago customer reassignment. The check fires only when a
      // value is supplied AND it differs from the current row.
      const isReassign = body.lagoCustomerExternalId !== undefined &&
        body.lagoCustomerExternalId !==
          currentMapping.lagoCustomerExternalId;

      if (isReassign && !confirmReassign) {
        // Without explicit confirm, refuse the rewrite. The body is verbose
        // because the admin UI uses it to render a warning prompt.
        return new Response(
          JSON.stringify({
            error: "REASSIGN_REQUIRED",
            message:
              `Reassigning will transfer historical session visibility from Lago customer ${currentMapping.lagoCustomerExternalId} to ${body.lagoCustomerExternalId}. Re-submit with ?confirm_reassign=true to proceed.`,
            currentLagoCustomerExternalId:
              currentMapping.lagoCustomerExternalId,
            newLagoCustomerExternalId: body.lagoCustomerExternalId,
            currentUserId: currentMapping.userId,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }

      // Wrap the update + (optional) reassign + child cascade in a single tx.
      // syncSingleTagToSteve fires AFTER the tx commits so the StEvE call
      // reflects the latest DB state.
      const updatedMappings: schema.UserMapping[] = [];
      let mapping: schema.UserMapping | null = null;
      let reassignedFromUserId: string | null = null;
      let reassignedToUserId: string | null = null;

      try {
        await db.transaction(async (tx) => {
          // If reassigning, resolve/create the new customer account and
          // attach userId to the update so both the parent and the children
          // get the right ownership.
          if (isReassign) {
            const account = await resolveOrCreateCustomerAccount(
              tx,
              body.lagoCustomerExternalId,
            );
            reassignedFromUserId = currentMapping.userId;
            reassignedToUserId = account.userId;
            updates.userId = account.userId;
          }

          // Update the parent mapping
          const [updatedParent] = await tx
            .update(schema.userMappings)
            .set(updates)
            .where(eq(schema.userMappings.id, id))
            .returning();
          mapping = updatedParent;
          updatedMappings.push(updatedParent);

          // If Lago customer/subscription changed, update child mappings too.
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
              const childUpdates: Partial<
                typeof schema.userMappings.$inferInsert
              > = {
                lagoCustomerExternalId: body.lagoCustomerExternalId ??
                  currentMapping.lagoCustomerExternalId,
                lagoSubscriptionExternalId: body.lagoSubscriptionExternalId ??
                  currentMapping.lagoSubscriptionExternalId,
              };
              if (isReassign && updates.userId !== undefined) {
                childUpdates.userId = updates.userId;
              }
              const [updatedChild] = await tx
                .update(schema.userMappings)
                .set(childUpdates)
                .where(
                  eq(schema.userMappings.steveOcppTagPk, childTag.ocppTagPk),
                )
                .returning();
              if (updatedChild) updatedMappings.push(updatedChild);
            }
          }
        });
      } catch (err) {
        if (err instanceof ProvisionerError) {
          return new Response(
            JSON.stringify({ error: err.message, code: err.code }),
            {
              status: err.status,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw err;
      }

      // Audit the reassignment AFTER the tx commits. logAuthEvent swallows
      // its own errors; safe to await.
      if (isReassign) {
        await logAuthEvent("customer.account.auto_provisioned", {
          userId: reassignedToUserId,
          metadata: {
            event: "mapping.reassigned",
            mappingId: id,
            previousUserId: reassignedFromUserId,
            newUserId: reassignedToUserId,
            previousLagoCustomerExternalId:
              currentMapping.lagoCustomerExternalId,
            newLagoCustomerExternalId: body.lagoCustomerExternalId,
          },
        });
      }

      // Inline StEvE sync per affected mapping. Especially important for the
      // is_active toggle path.
      for (const um of updatedMappings) {
        await syncSingleTagToSteve(um);
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

  // Soft-deactivate THIS mapping only.
  // - Flip is_active=false on the target row (preserving user_id so
  //   historical session joins still resolve).
  // - Child mappings that inherit via StEvE's parentIdTag hierarchy are
  //   hard links: they are only modified in StEvE directly or via an
  //   explicit UI action. Unlinking a parent must not silently deactivate
  //   descendants.
  // - Inline-sync the flipped mapping to StEvE so the user can't charge
  //   the millisecond after admin clicks "Unlink".
  // - If the user has zero remaining active mappings, bulk-cancel any
  //   future-dated reservations they own.
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

      const updatedMappings: schema.UserMapping[] = [];

      await db.transaction(async (tx) => {
        const [parent] = await tx
          .update(schema.userMappings)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.userMappings.id, id))
          .returning();
        if (parent) updatedMappings.push(parent);
      });

      // Push every flip to StEvE inline (best-effort).
      for (const um of updatedMappings) {
        await syncSingleTagToSteve(um);
      }

      // If the customer has no active mappings remaining, cancel their
      // future reservations so they don't show stale upcoming bookings.
      // currentMapping.userId may be null (rare legacy state); skip in that
      // case because there's nothing to cancel for "no user".
      let cancelledReservationCount = 0;
      if (currentMapping.userId) {
        const remainingActive = await db
          .select({ id: schema.userMappings.id })
          .from(schema.userMappings)
          .where(
            and(
              eq(schema.userMappings.userId, currentMapping.userId),
              eq(schema.userMappings.isActive, true),
            ),
          )
          .limit(1);
        if (remainingActive.length === 0) {
          cancelledReservationCount = await bulkCancelFutureReservationsForUser(
            currentMapping.userId,
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          deactivatedCount: updatedMappings.length,
          cancelledReservationCount,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to soft-deactivate mapping", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to soft-deactivate mapping" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
