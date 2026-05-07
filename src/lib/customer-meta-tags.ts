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
 * LEGACY-1 mapping (Gen 1, 2026-05-06 and earlier): `OCPP-{externalId}`.
 * @deprecated Detection-only. Used by the rename migration to find old
 * tags for reparenting + deletion. Never write this format.
 */
export function parentIdTagFor(externalId: string): string {
  return `OCPP-${externalId}`;
}

/**
 * LEGACY-2 mapping (Gen 2, 2026-05-07 morning): `OCPP-{userPublicId}`.
 * Briefly minted before the format settled on `META-`. Detection-only,
 * used to clean up rows the first apply pass created.
 * @deprecated
 */
export function legacyOcppParentIdTagForUserPublicId(
  userPublicId: string,
): string {
  return `OCPP-${userPublicId}`;
}

/**
 * Canonical mapping (Gen 3, 2026-05-07 onward) from a user's 8-char
 * public ID to its managed parent tag in StEvE: `META-{publicId}`.
 * Pure — no I/O. The publicId column is NOT NULL UNIQUE (migration
 * 0046) so this is collision-free. Renamed from `OCPP-` so the parent
 * tag visually distinguishes itself from the OCPP prefix StEvE uses
 * everywhere else, and so admins reading StEvE's tag list can spot
 * "this is a customer meta-tag, not a child card" at a glance.
 */
export function parentIdTagForUserPublicId(userPublicId: string): string {
  return `META-${userPublicId}`;
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
  // back to the legacy externalId format so we still produce a usable
  // tag.
  const userPublicId = await resolveUserPublicIdForLagoCustomer(externalId);
  const idTag = userPublicId !== null
    ? parentIdTagForUserPublicId(userPublicId)
    : parentIdTagFor(externalId);
  // Both legacy formats we'll clean up if encountered: Gen 1
  // (`OCPP-<externalId>`, 2026-05-06 and earlier) and Gen 2
  // (`OCPP-<publicId>`, briefly used 2026-05-07 morning).
  const legacyIdTags: string[] = [parentIdTagFor(externalId)];
  if (userPublicId !== null) {
    legacyIdTags.push(legacyOcppParentIdTagForUserPublicId(userPublicId));
  }
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

  // ---- 3. legacy parent cleanup --------------------------------------
  //
  // Two prior tag formats need to be migrated and removed:
  //   Gen 1: `OCPP-<lagoExternalId>` (initial format, 2026-05-06 and
  //          earlier).
  //   Gen 2: `OCPP-<userPublicId>` (briefly minted 2026-05-07 morning
  //          before the format settled on the META- prefix).
  // For each legacy tag still present in StEvE we:
  //   a) reparent every child to the new META- tag,
  //   b) delete the local user_mappings row (we don't preserve it —
  //      historical synced_transaction_events rows still join via
  //      user_mapping_id, so we ON DELETE the user_mappings row only
  //      after detaching it; in practice we set it to is_active=false
  //      and let a separate prune pass remove the rows. For safety we
  //      keep the row and only flip is_active here.),
  //   c) DELETE the legacy tag from StEvE (now that no children
  //      reference it).
  // Idempotent — repeat calls find nothing in StEvE and short-circuit.
  for (const legacyIdTag of legacyIdTags) {
    if (legacyIdTag === idTag) continue;
    if (ocppTagPk === null) continue;
    try {
      const [legacyTag] = await steveClient.getOcppTags({ idTag: legacyIdTag });
      if (!legacyTag) continue;

      // Reparent children. We must do this BEFORE deleting the parent.
      const children = await steveClient.getOcppTags({
        parentIdTag: legacyIdTag,
      });
      for (const child of children) {
        try {
          await steveClient.updateOcppTag({ ...child, parentIdTag: idTag });
        } catch (err) {
          log.warn("Failed to reparent child tag during cleanup", {
            childIdTag: child.idTag,
            from: legacyIdTag,
            to: idTag,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Drop the local user_mappings row referencing this legacy tag
      // so the admin Tags listing stops surfacing it. The
      // synced_transaction_events FK to user_mappings has no cascade,
      // so we use a soft approach: flip is_active to false. A separate
      // post-cleanup pass deletes the row when no transaction events
      // reference it. Tracked as a follow-up; keeping the row safe by
      // default avoids breaking historical session joins.
      try {
        await db
          .update(schema.userMappings)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.userMappings.steveOcppIdTag, legacyIdTag));
      } catch (err) {
        log.warn("Failed to deactivate legacy user_mappings row", {
          legacyIdTag,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Delete the legacy tag from StEvE. Now that no children point at
      // it and the local row is deactivated, no client should ever
      // reference it again.
      try {
        await steveClient.deleteOcppTag(legacyTag.ocppTagPk);
      } catch (err) {
        log.warn("Failed to DELETE legacy meta-tag from StEvE", {
          legacyIdTag,
          ocppTagPk: legacyTag.ocppTagPk,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      log.warn("Legacy meta-tag cleanup failed; will retry next call", {
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
