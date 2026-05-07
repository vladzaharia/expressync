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
 * LEGACY deterministic mapping from a Lago customer's `external_id` to
 * the old-format OCPP parent tag. Pure — no I/O. Kept exported so the
 * migration script and a small number of legacy callers can still
 * resolve the pre-rename tag in StEvE for cleanup; new code should use
 * `parentIdTagForUserPublicId` instead.
 *
 * @deprecated Use `parentIdTagForUserPublicId(publicId)` for new
 * tags. This function resolves to the format used before the
 * 2026-05-07 rename and is retained only for migration / reparenting
 * paths.
 */
export function parentIdTagFor(externalId: string): string {
  return `OCPP-${externalId}`;
}

/**
 * Canonical mapping from a user's 8-char public ID to its managed
 * OCPP parent tag in StEvE. Pure — no I/O. The publicId column is
 * NOT NULL UNIQUE (migration 0046) so this is collision-free.
 */
export function parentIdTagForUserPublicId(userPublicId: string): string {
  return `OCPP-${userPublicId}`;
}

/**
 * Resolve a Lago customer's user_publicId via the joined users table.
 * Used by `ensureCustomerMetaTag` to compute the new-format parent
 * tag without breaking the old function signature.
 */
async function resolveUserPublicIdForLagoCustomer(
  externalId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ publicId: schema.users.publicId })
    .from(schema.users)
    .where(eq(schema.users.lagoCustomerExternalId, externalId))
    .limit(1);
  return row?.publicId ?? null;
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
  // Resolve the customer's user_publicId. After migration 0046 every
  // user row has one; for an extreme edge case where a Lago customer
  // exists without a corresponding user (e.g. mid-provisioning), fall
  // back to the legacy format so we still produce a usable tag.
  const userPublicId = await resolveUserPublicIdForLagoCustomer(externalId);
  const idTag = userPublicId !== null
    ? parentIdTagForUserPublicId(userPublicId)
    : parentIdTagFor(externalId);
  const legacyIdTag = parentIdTagFor(externalId);
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
      // Resolve the auth user that owns this Lago customer. Required for
      // `resolveCustomerScope` (which filters user_mappings by user_id) to
      // see the meta-tag mapping — without it, remote-start sessions
      // through the meta-tag never attribute to the customer's scope.
      const [owner] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.lagoCustomerExternalId, externalId))
        .limit(1);
      const ownerUserId = owner?.id ?? null;

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
            // Only fill userId when missing — never clobber an admin-set value.
            userId: existingRow.userId ?? ownerUserId,
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
          userId: ownerUserId,
        });
      }
    }
  } catch (err) {
    log.warn("user_mappings upsert for meta-tag failed", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- 3. legacy parent reparenting + deactivation --------------------
  //
  // The 2026-05-07 rename moves the meta-tag from `OCPP-{externalId}` to
  // `OCPP-{userPublicId}`. When this is the first call for a customer
  // post-rename, both tags exist in StEvE: the new one we just upserted
  // and the legacy one with all the customer's child cards still
  // parented to it. We:
  //   a) reparent every child of the legacy tag to the new tag,
  //   b) deactivate the legacy tag (maxActiveTransactionCount=0) so any
  //      in-flight transaction can finish but no new one can start.
  // Idempotent — once the legacy tag has zero children and is
  // deactivated, repeated calls are no-ops.
  if (idTag !== legacyIdTag && ocppTagPk !== null) {
    try {
      const [legacyTag] = await steveClient.getOcppTags({ idTag: legacyIdTag });
      if (legacyTag) {
        // Reparent every child whose parent_id_tag still references
        // the legacy tag.
        const children = await steveClient.getOcppTags({
          parentIdTag: legacyIdTag,
        });
        for (const child of children) {
          try {
            await steveClient.updateOcppTag({ ...child, parentIdTag: idTag });
          } catch (err) {
            log.warn("Failed to reparent child tag during rename", {
              childIdTag: child.idTag,
              from: legacyIdTag,
              to: idTag,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        // Deactivate the legacy parent so new transactions can't start
        // against it. We don't delete — preserving the row keeps StEvE's
        // historical-transaction joins intact.
        if (legacyTag.maxActiveTransactionCount !== 0) {
          try {
            await steveClient.updateOcppTag({
              ...legacyTag,
              maxActiveTransactionCount: 0,
            });
          } catch (err) {
            log.warn("Failed to deactivate legacy meta-tag during rename", {
              legacyIdTag,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        // Also flip the local user_mappings row for the legacy tag to
        // is_active=false so the admin UI reflects the deactivation.
        try {
          await db
            .update(schema.userMappings)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              eq(schema.userMappings.steveOcppIdTag, legacyIdTag),
            );
        } catch (err) {
          log.warn("Failed to deactivate legacy user_mappings row", {
            legacyIdTag,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      log.warn("Legacy meta-tag rename pass failed; will retry next call", {
        legacyIdTag,
        idTag,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

// ============================================================================
// Per-device OCPP tags (Wave W12 — added 2026-05-07)
// ============================================================================
//
// Customer device registration auto-mints a per-device OCPP tag so the
// iOS Mobile Start flow can submit charging requests with a tag that
// uniquely identifies *this device's customer* — no admin tag picker
// required. The tag's name is derived from the user's public ID +
// device ID prefix so it's both human-readable in the StEvE admin and
// deterministic across re-registers (same device → same tag, no
// orphaning).
//
// TODO(meta-tag-rename): the customer's parent meta-tag still uses
// `OCPP-{lagoExternalId}` (see `parentIdTagFor` above). Per the
// 2026-05-07 plan we want to rename that to `OCPP-{userPublicId}`,
// but the rename touches in-flight billing attribution and needs its
// own migration with rollback. Track in a dedicated branch.

const DEVICE_TAG_PREFIX = "OCPP-D-";

/**
 * Deterministic mapping from (userPublicId, deviceId) to a per-device
 * OCPP tag. Pure — no I/O. Length is bounded by StEvE's tag-name limit
 * (typically 20 chars); we use the first 6 hex chars of the device UUID
 * to stay under that.
 */
export function deviceIdTagFor(
  userPublicId: string,
  deviceId: string,
): string {
  // device IDs are UUIDs; first 6 chars of the hex representation give
  // ~16M variants per user — collision-free in practice for a friends-
  // and-family fleet of phones.
  const short = deviceId.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${DEVICE_TAG_PREFIX}${userPublicId}-${short}`;
}

export interface EnsureDeviceTagResult {
  idTag: string;
  ocppTagPk: number | null;
  isActive: boolean;
}

/**
 * Idempotent upsert of a per-device OCPP tag in StEvE plus the matching
 * `user_mappings` row. Re-registering the same device under the same
 * user converges on the same tag without orphaning the old one.
 *
 * The created tag is parented to the customer's meta-tag so billing
 * config inherits — admins don't have to configure each device-tag
 * separately.
 */
export async function ensureDeviceTag(
  deviceId: string,
  userId: string,
  userPublicId: string,
  displayName?: string,
): Promise<EnsureDeviceTagResult> {
  const idTag = deviceIdTagFor(userPublicId, deviceId);

  // ---- 1. resolve the parent meta-tag for billing inheritance ---------
  const [user] = await db
    .select({
      role: schema.users.role,
      lagoCustomerExternalId: schema.users.lagoCustomerExternalId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  // Hard guard: admins never get OCPP tags. Admin accounts have no
  // Lago customer or subscription associated with them, so a tag
  // would be a billing-attribution dead-end. Returning early here
  // protects every call site (the QR sign-in handler already 404s
  // non-customers, but the helper should be defensive against future
  // call sites that bypass that check).
  if (!user || user.role !== "customer") {
    log.info(
      "ensureDeviceTag skipped — non-customer user; admins don't carry OCPP tags",
      { deviceId, userId, role: user?.role ?? "unknown" },
    );
    return { idTag, ocppTagPk: null, isActive: false };
  }

  const parentIdTag = user.lagoCustomerExternalId
    ? parentIdTagFor(user.lagoCustomerExternalId)
    : null;

  // ---- 2. upsert in StEvE ---------------------------------------------
  let ocppTagPk: number | null = null;
  let isActive = true;
  try {
    const existing = await steveClient.getOcppTags({ idTag });
    if (existing.length > 0) {
      const tag = existing[0];
      ocppTagPk = tag.ocppTagPk;
      isActive = (tag.maxActiveTransactionCount ?? 0) > 0;
    } else {
      const created = await steveClient.createOcppTag(idTag, {
        note: displayName
          ? `ExpressCharge device — ${displayName}`
          : "ExpressCharge device",
        maxActiveTransactionCount: 1,
        parentIdTag: parentIdTag ?? undefined,
      });
      ocppTagPk = created.ocppTagPk;
    }
  } catch (err) {
    log.warn("StEvE device-tag upsert failed; mapping write skipped", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- 3. user_mappings row -------------------------------------------
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
            displayName: existingRow.displayName ?? displayName ?? null,
            isActive,
            userId: existingRow.userId ?? userId,
            deviceId: existingRow.deviceId ?? deviceId,
            steveParentIdTag: parentIdTag,
            tagType: "phone_nfc",
            updatedAt: new Date(),
          })
          .where(eq(schema.userMappings.id, existingRow.id));
      } else {
        await db.insert(schema.userMappings).values({
          steveOcppTagPk: ocppTagPk,
          steveOcppIdTag: idTag,
          displayName: displayName ?? null,
          tagType: "phone_nfc",
          isActive,
          userId,
          deviceId,
          steveParentIdTag: parentIdTag,
        });
      }
    }
  } catch (err) {
    log.warn("user_mappings upsert for device-tag failed", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { idTag, ocppTagPk, isActive };
}

/**
 * Deactivate a device's OCPP tag in StEvE and flip its
 * `user_mappings.is_active` to false. Called from device deletion +
 * deregister paths so the StEvE tag table doesn't accumulate orphans.
 *
 * The user_mappings row itself is preserved (not deleted) because the
 * `device_id` FK cascades on device row delete; this helper handles the
 * StEvE side of the cleanup so OCPP doesn't accept post-deregister
 * charging requests.
 */
export async function revokeDeviceTag(deviceId: string): Promise<void> {
  let rows: Array<{ id: number; ocppTagPk: number; idTag: string }> = [];
  try {
    rows = (await db
      .select({
        id: schema.userMappings.id,
        ocppTagPk: schema.userMappings.steveOcppTagPk,
        idTag: schema.userMappings.steveOcppIdTag,
      })
      .from(schema.userMappings)
      .where(eq(schema.userMappings.deviceId, deviceId))) as typeof rows;
  } catch (err) {
    log.warn("device-tag lookup failed; cleanup skipped", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const row of rows) {
    try {
      const [tag] = await steveClient.getOcppTags({ idTag: row.idTag });
      if (tag) {
        await steveClient.updateOcppTag({
          ...tag,
          maxActiveTransactionCount: 0,
        });
      }
    } catch (err) {
      log.warn("StEvE deactivate failed for device-tag", {
        idTag: row.idTag,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await db
        .update(schema.userMappings)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.userMappings.id, row.id));
    } catch (err) {
      log.warn("user_mappings deactivate failed for device-tag", {
        idTag: row.idTag,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
