/**
 * @deprecated Slice S — superseded by `/api/admin/devices/{id}/customers`.
 *   The iOS app no longer calls this endpoint after Slice S; it is kept for
 *   one rolling-deploy window so older iOS clients in the field don't break.
 *   Delete in a follow-up once the previous app version is gone.
 *
 * ExpresScan v2 / Wave 6 Slice J — admin charger tag list.
 *
 * GET /api/admin/devices/{deviceId}/tags
 *
 * Bearer-auth'd device-API endpoint (the iOS Tag Picker sheet calls this
 * to populate the start-charging tag list). `[deviceId]` is the **charger**
 * id — i.e. `chargers.charge_box_id`. App-side device IDs are
 * uuid-shaped; charger IDs are the StEvE chargeBoxId string.
 *
 * Returns a flat list of `idTag` rows (one per active `user_mappings`
 * row), each with the linked customer label and a `lastUsedAt` derived
 * from recent transactions on this charger. Sort: most-recently-used
 * first, then unused tags alphabetically by idTag. The list is capped
 * at 100 to keep a noisy fleet from blowing up the picker; in practice
 * friends-and-family fleets have <20 active tags.
 *
 * Response shape:
 *   {
 *     tags: Array<{
 *       idTag: string;
 *       tagPk: number;
 *       customerName: string | null;
 *       customerId: string;
 *       isOwn: boolean;
 *       lastUsedAt: string | null;  // ISO
 *     }>;
 *   }
 *
 * Auth + gates:
 *   - Bearer (`/api/admin/devices/{id}/tags` is bearer per `selectAuth`).
 *   - `requireCapability(ctx, "user")` — 403 on miss.
 *   - 404 if `deviceId` is not a charger row in `chargers`. We
 *     don't 404 to confirm "this is an app device" — anti-enumeration.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import {
  chargers,
  syncedTransactionEvents,
  userMappings,
  users,
} from "../../../../../src/db/schema.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../../../src/lib/devices/capability-gate.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceTagsAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface TagRow {
  idTag: string;
  tagPk: number;
  customerName: string | null;
  customerId: string;
  isOwn: boolean;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Test seams. Module-level loaders so handler-direct unit tests can substitute
// the DB-bound queries without spinning up Postgres. Each setter takes `null`
// to restore the default.
// ---------------------------------------------------------------------------

type OwnerLagoLoader = (userId: string) => Promise<string | null>;
type ChargerExistsCheck = (chargeBoxId: string) => Promise<boolean>;
type TagsLoader = (
  chargeBoxId: string,
) => Promise<
  Array<{
    tagPk: number;
    idTag: string;
    customerId: string;
    customerName: string | null;
    lastUsedAt: Date | null;
  }>
>;

const defaultOwnerLagoLoader: OwnerLagoLoader = async (userId) => {
  const [row] = await db
    .select({ lagoCustomerExternalId: users.lagoCustomerExternalId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.lagoCustomerExternalId ?? null;
};

const defaultChargerExistsCheck: ChargerExistsCheck = async (chargeBoxId) => {
  const [row] = await db
    .select({ chargeBoxId: chargers.chargeBoxId })
    .from(chargers)
    .where(eq(chargers.chargeBoxId, chargeBoxId))
    .limit(1);
  return !!row;
};

const defaultTagsLoader: TagsLoader = async (chargeBoxId) => {
  // Active user_mappings — every active OCPP tag is a candidate. We
  // also exclude the synthetic `admin-blackout` sentinel; it is not
  // pickable by an operator.
  const mappings = await db
    .select({
      tagPk: userMappings.steveOcppTagPk,
      idTag: userMappings.steveOcppIdTag,
      lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
      displayName: userMappings.displayName,
    })
    .from(userMappings)
    .where(
      and(
        eq(userMappings.isActive, true),
        isNotNull(userMappings.lagoCustomerExternalId),
      ),
    );
  if (mappings.length === 0) return [];

  const mappingIds = mappings.map((m) => m.tagPk);
  // For "lastUsedAt" we group recent transaction events by tag. We scope
  // by chargeBoxId via `transaction_sync_state` … but `synced_transaction_events`
  // doesn't carry chargeBoxId directly; the customer-portal scope helper
  // doesn't need it either. We index by `userMappingId` and filter by
  // mappings used on *any* charger — sorting by recency is what matters
  // for the picker. (Per-charger recency would require a join to StEvE's
  // transaction table; out of scope for the iOS picker which is a flat
  // recency list.)
  const _suppress = chargeBoxId;
  void _suppress;
  const ump = inArray(syncedTransactionEvents.userMappingId, mappingIds);
  const recent = await db
    .select({
      userMappingId: syncedTransactionEvents.userMappingId,
      lastUsedAt: sql<Date>`MAX(${syncedTransactionEvents.syncedAt})`.as(
        "last_used_at",
      ),
    })
    .from(syncedTransactionEvents)
    .where(ump)
    .groupBy(syncedTransactionEvents.userMappingId);
  const lastUsedByPk = new Map<number, Date>();
  for (const r of recent) {
    if (r.userMappingId !== null && r.lastUsedAt) {
      lastUsedByPk.set(r.userMappingId, r.lastUsedAt);
    }
  }
  return mappings.map((m) => ({
    tagPk: m.tagPk,
    idTag: m.idTag,
    customerId: m.lagoCustomerExternalId ?? "",
    customerName: m.displayName,
    lastUsedAt: lastUsedByPk.get(m.tagPk) ?? null,
  }));
};

let ownerLagoLoader: OwnerLagoLoader = defaultOwnerLagoLoader;
let chargerExistsCheck: ChargerExistsCheck = defaultChargerExistsCheck;
let tagsLoader: TagsLoader = defaultTagsLoader;

export function _setOwnerLagoLoaderForTests(fn: OwnerLagoLoader | null): void {
  ownerLagoLoader = fn ?? defaultOwnerLagoLoader;
}
export function _setChargerExistsCheckForTests(
  fn: ChargerExistsCheck | null,
): void {
  chargerExistsCheck = fn ?? defaultChargerExistsCheck;
}
export function _setTagsLoaderForTests(fn: TagsLoader | null): void {
  tagsLoader = fn ?? defaultTagsLoader;
}
export function _resetTagsTestSeams(): void {
  ownerLagoLoader = defaultOwnerLagoLoader;
  chargerExistsCheck = defaultChargerExistsCheck;
  tagsLoader = defaultTagsLoader;
}

// Suppress unused-import warning. `desc` is the natural sort direction we
// document above; the actual ordering happens in JS so the sort stays
// stable across `lastUsedAt = null` rows. Keep the import for future
// SQL-side ordering if we revisit.
void desc;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = define.handlers({
  async GET(ctx) {
    log.warn(
      "DEPRECATED Slice S: GET /admin/devices/[id]/tags called — " +
        "iOS should be using /customers. This handler will be removed.",
    );
    if (!ctx.state.device) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    try {
      await requireCapability(ctx, "user");
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "capability_denied",
          missing: err.missing,
        });
      }
      throw err;
    }

    const chargerId = ctx.params.deviceId;
    if (!chargerId || chargerId.length === 0) {
      return jsonResponse(404, { error: "not_found" });
    }

    let exists: boolean;
    try {
      exists = await chargerExistsCheck(chargerId);
    } catch (err) {
      log.error("Failed to check charger existence", {
        chargerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal_error" });
    }
    if (!exists) return jsonResponse(404, { error: "not_found" });

    let rows: Awaited<ReturnType<TagsLoader>>;
    try {
      rows = await tagsLoader(chargerId);
    } catch (err) {
      log.error("Failed to load tags", {
        chargerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal_error" });
    }

    let callerLagoId: string | null = null;
    try {
      callerLagoId = await ownerLagoLoader(ctx.state.device.ownerUserId);
    } catch (err) {
      log.warn("Owner-lago lookup failed; isOwn will be false", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const tags: TagRow[] = rows.map((r) => ({
      idTag: r.idTag,
      tagPk: r.tagPk,
      // `isOwn` true when the tag's lago customer external id matches the
      // caller device-owner's lago id. Today's friends-and-family scope
      // means the device owner is admin-role; this returns false for all
      // current callers but the field is plumbed for the customer-token
      // rollout (a customer device's owner *will* match its own tag(s)).
      isOwn: callerLagoId !== null && r.customerId === callerLagoId,
      customerId: r.customerId,
      customerName: r.customerName,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    }));

    // Sort: most-recently-used first; unused tags alphabetically by idTag.
    tags.sort((a, b) => {
      if (a.lastUsedAt && b.lastUsedAt) {
        return a.lastUsedAt < b.lastUsedAt ? 1 : -1;
      }
      if (a.lastUsedAt) return -1;
      if (b.lastUsedAt) return 1;
      return a.idTag.localeCompare(b.idTag);
    });

    return jsonResponse(200, { tags: tags.slice(0, 100) });
  },
});
