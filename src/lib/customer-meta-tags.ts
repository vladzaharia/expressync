/**
 * Customer meta-tag helpers — full lifecycle management.
 *
 * Every Lago customer is modeled in StEvE by a single auto-managed parent
 * OCPP tag named `OCPP-{externalId}`. Children (real cards) carry that
 * string in `parent_id_tag` so StEvE's tag-hierarchy resolves billing
 * config from the parent. The iOS remote-start flow targets the parent
 * directly so admins/customers can start a charge by selecting the
 * customer (no specific card).
 *
 * Active state on the meta-tag follows the customer's first active
 * subscription:
 *   - active sub exists  → StEvE `maxActiveTransactionCount = 1`
 *                          (remote-start succeeds; child cards inherit)
 *   - no active sub      → StEvE `maxActiveTransactionCount = 0`
 *                          (remote-start fails until billing is set up)
 *
 * The companion `user_mappings` row carries
 *   `lagoCustomerExternalId = externalId`
 *   `lagoSubscriptionExternalId = first active sub external_id || null`
 * so the same data drives the admin Tags listing.
 *
 * All operations are idempotent — safe to call from webhooks, sync, and
 * defensive call sites without state checks.
 */

import { eq } from "drizzle-orm";
import { db } from "@/src/db/index.ts";
import * as schema from "@/src/db/schema.ts";
import { steveClient } from "./steve-client.ts";
import { lagoClient } from "./lago-client.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child("CustomerMetaTags");

/**
 * Deterministic mapping from a Lago customer's `external_id` to its
 * managed OCPP parent tag in StEvE. Pure — no I/O.
 */
export function parentIdTagFor(externalId: string): string {
  return `OCPP-${externalId}`;
}

/**
 * Look up the customer's first active subscription's `external_id`, or
 * `null` when none exists. Used to drive both the meta-tag's StEvE active
 * state and the `user_mappings.lagoSubscriptionExternalId` column.
 */
async function firstActiveSubscriptionExternalId(
  externalCustomerId: string,
): Promise<string | null> {
  try {
    const { subscriptions } = await lagoClient.getSubscriptions(
      externalCustomerId,
    );
    const active = subscriptions.find((s) => s.status === "active");
    return active?.external_id ?? null;
  } catch (err) {
    log.warn("Subscription lookup failed; treating customer as no-active-sub", {
      externalCustomerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface EnsureMetaTagResult {
  idTag: string;
  ocppTagPk: number | null;
  isActive: boolean;
  lagoSubscriptionExternalId: string | null;
}

/**
 * Idempotent upsert of the `OCPP-{externalId}` parent tag in StEvE plus
 * the matching `user_mappings` row.
 *
 * On every call:
 *   1. Resolve the customer's first active subscription (best-effort).
 *   2. Look up the StEvE tag — create with the right
 *      `maxActiveTransactionCount` if missing, update otherwise.
 *   3. Upsert `user_mappings` so the local store is consistent.
 *
 * Returns the canonical idTag plus the resolved StEvE PK and active
 * state. Failures are logged and swallowed; callers can use the returned
 * `ocppTagPk: null` as a signal that StEvE hasn't materialized yet.
 */
export async function ensureCustomerMetaTag(
  externalId: string,
  displayName?: string,
): Promise<EnsureMetaTagResult> {
  const idTag = parentIdTagFor(externalId);
  const subExternalId = await firstActiveSubscriptionExternalId(externalId);
  const isActive = subExternalId !== null;
  const maxActiveTransactionCount = isActive ? 1 : 0;

  // ---- 1. StEvE tag ----------------------------------------------------
  let ocppTagPk: number | null = null;
  try {
    const existing = await steveClient.getOcppTags({ idTag });
    if (existing.length > 0) {
      const tag = existing[0];
      ocppTagPk = tag.ocppTagPk;
      // Update only if the active state actually changed — saves a write
      // and reduces cross-system noise.
      if (tag.maxActiveTransactionCount !== maxActiveTransactionCount) {
        try {
          await steveClient.updateOcppTag({
            ...tag,
            maxActiveTransactionCount,
          });
        } catch (err) {
          log.warn("Failed to update existing meta-tag active state", {
            idTag,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      try {
        const created = await steveClient.createOcppTag(idTag, {
          note: displayName
            ? `ExpressCharge customer parent — ${displayName}`
            : "ExpressCharge customer parent",
          maxActiveTransactionCount,
        });
        ocppTagPk = created.ocppTagPk;
      } catch (err) {
        log.warn("createOcppTag failed; assuming tag may already exist", {
          idTag,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    log.warn("StEvE meta-tag lookup failed; downstream upsert may diverge", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- 2. user_mappings row -------------------------------------------
  // Persist whenever StEvE gave us a PK (we need the FK target). When
  // StEvE is unavailable but a row already exists, we still update its
  // active flag + sub linkage so the admin UI reflects current intent.
  try {
    if (ocppTagPk !== null) {
      const [existingRow] = await db
        .select()
        .from(schema.userMappings)
        .where(eq(schema.userMappings.steveOcppTagPk, ocppTagPk))
        .limit(1);

      if (existingRow) {
        await db
          .update(schema.userMappings)
          .set({
            steveOcppIdTag: idTag,
            lagoCustomerExternalId: externalId,
            lagoSubscriptionExternalId: subExternalId,
            displayName: existingRow.displayName ?? displayName ?? null,
            isActive,
            updatedAt: new Date(),
          })
          .where(eq(schema.userMappings.id, existingRow.id));
      } else {
        await db.insert(schema.userMappings).values({
          steveOcppTagPk: ocppTagPk,
          steveOcppIdTag: idTag,
          lagoCustomerExternalId: externalId,
          lagoSubscriptionExternalId: subExternalId,
          displayName: displayName ?? null,
          tagType: "other",
          isActive,
        });
      }
    }
  } catch (err) {
    log.warn("user_mappings upsert for meta-tag failed", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    idTag,
    ocppTagPk,
    isActive,
    lagoSubscriptionExternalId: subExternalId,
  };
}

/**
 * Re-evaluate active state for an existing meta-tag. Cheap convenience
 * wrapper around `ensureCustomerMetaTag` — call it from
 * subscription.created/terminated webhooks once those land.
 */
export function refreshCustomerMetaTag(
  externalId: string,
): Promise<EnsureMetaTagResult> {
  return ensureCustomerMetaTag(externalId);
}
