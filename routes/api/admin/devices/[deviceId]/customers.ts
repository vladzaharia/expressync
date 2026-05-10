/**
 * ExpresScan v2 / Wave 6 Slice S — admin charger customer list.
 *
 * GET /api/admin/devices/{deviceId}/customers
 *
 * Bearer-auth'd device-API endpoint. Replaces `/tags` for the iOS picker:
 * the operator picks a *customer*, not a tag, and the server resolves
 * `OCPP-{externalId}` (the customer's auto-managed parent meta-tag) at
 * Start time. `[deviceId]` is the **charger** id — i.e.
 * `chargers.charge_box_id`.
 *
 * Returns a flat list of the org's customers with at least one active
 * mapping, sorted by recency-of-use (most recent transaction first), then
 * alphabetically by displayName for ties / unused customers. Capped at
 * 200 — friends-and-family fleets stay well below.
 *
 * Response shape:
 *   {
 *     customers: Array<{
 *       lagoCustomerExternalId: string;
 *       userId: string;
 *       displayName: string;        // name → email → userId
 *       name: string | null;
 *       email: string | null;
 *       isOwn: boolean;             // matches calling device's owner
 *       lastUsedAt: string | null;  // ISO; most recent tx across charger fleet
 *     }>;
 *   }
 *
 * Auth + gates:
 *   - Bearer (`/api/admin/devices/{id}/customers` is bearer per `selectAuth`).
 *   - `requireCapability(ctx, "user")` — 403 on miss.
 *   - 404 if `deviceId` is not a charger row in `chargers`.
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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

const log = logger.child("AdminDeviceCustomersAPI");

const MAX_CUSTOMERS = 200;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface CustomerOption {
  lagoCustomerExternalId: string;
  userId: string;
  displayName: string;
  name: string | null;
  email: string | null;
  isOwn: boolean;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Test seams — handler-direct stubbable loaders. Mirrors the `tags.ts` /
// `index.ts` pattern.
// ---------------------------------------------------------------------------

interface CustomerRow {
  lagoCustomerExternalId: string;
  userId: string;
  name: string | null;
  email: string | null;
  lastUsedAt: Date | null;
}

type OwnerLagoLoader = (userId: string) => Promise<string | null>;
type ChargerExistsCheck = (chargeBoxId: string) => Promise<boolean>;
type CustomersLoader = () => Promise<CustomerRow[]>;

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

/**
 * Default customers loader. The shape is "every customer-role user with at
 * least one active mapping". We dedupe by `lagoCustomerExternalId` (one row
 * per customer) and pull the `users` join through `user_mappings.user_id`.
 *
 * Recency-of-use is best-effort across the whole charger fleet — the iOS
 * picker uses it as a soft sort hint only, not as a per-charger filter.
 */
const defaultCustomersLoader: CustomersLoader = async () => {
  // Mappings → users (only customer-role, only active). Group by user so
  // a customer with multiple mappings shows up once.
  const mappingRows = await db
    .select({
      mappingId: userMappings.id,
      mappingUserId: userMappings.userId,
      lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(userMappings)
    .innerJoin(users, eq(userMappings.userId, users.id))
    .where(
      // active mapping + linked to a customer-role user + has a Lago id
      // (the picker only surfaces billable customers).
      and(
        eq(userMappings.isActive, true),
        isNotNull(userMappings.lagoCustomerExternalId),
      ),
    );

  const byCustomer = new Map<string, {
    userId: string;
    name: string | null;
    email: string | null;
    mappingIds: number[];
  }>();
  for (const r of mappingRows) {
    if (r.role !== "customer") continue;
    if (!r.lagoCustomerExternalId) continue;
    const existing = byCustomer.get(r.lagoCustomerExternalId);
    if (existing) {
      existing.mappingIds.push(r.mappingId);
      continue;
    }
    byCustomer.set(r.lagoCustomerExternalId, {
      userId: r.userId,
      name: r.name,
      email: r.email,
      mappingIds: [r.mappingId],
    });
  }

  const allMappingIds = Array.from(byCustomer.values()).flatMap(
    (v) => v.mappingIds,
  );

  // Best-effort recency: max(synced_transaction_events.synced_at) per mapping,
  // bubbled up to its customer. Single round-trip.
  const lastUsedByCustomer = new Map<string, Date>();
  if (allMappingIds.length > 0) {
    const recent = await db
      .select({
        userMappingId: syncedTransactionEvents.userMappingId,
        lastUsedAt: sql<Date>`MAX(${syncedTransactionEvents.syncedAt})`.as(
          "last_used_at",
        ),
      })
      .from(syncedTransactionEvents)
      .where(inArray(syncedTransactionEvents.userMappingId, allMappingIds))
      .groupBy(syncedTransactionEvents.userMappingId);

    const byMapping = new Map<number, Date>();
    for (const r of recent) {
      if (r.userMappingId !== null && r.lastUsedAt) {
        byMapping.set(r.userMappingId, r.lastUsedAt);
      }
    }
    for (const [extId, info] of byCustomer) {
      let max: Date | null = null;
      for (const mid of info.mappingIds) {
        const d = byMapping.get(mid);
        if (d && (!max || d > max)) max = d;
      }
      if (max) lastUsedByCustomer.set(extId, max);
    }
  }

  return Array.from(byCustomer.entries()).map(([extId, info]) => ({
    lagoCustomerExternalId: extId,
    userId: info.userId,
    name: info.name,
    email: info.email,
    lastUsedAt: lastUsedByCustomer.get(extId) ?? null,
  }));
};

let ownerLagoLoader: OwnerLagoLoader = defaultOwnerLagoLoader;
let chargerExistsCheck: ChargerExistsCheck = defaultChargerExistsCheck;
let customersLoader: CustomersLoader = defaultCustomersLoader;

export function _setOwnerLagoLoaderForTests(fn: OwnerLagoLoader | null): void {
  ownerLagoLoader = fn ?? defaultOwnerLagoLoader;
}
export function _setChargerExistsCheckForTests(
  fn: ChargerExistsCheck | null,
): void {
  chargerExistsCheck = fn ?? defaultChargerExistsCheck;
}
export function _setCustomersLoaderForTests(fn: CustomersLoader | null): void {
  customersLoader = fn ?? defaultCustomersLoader;
}
export function _resetCustomersTestSeams(): void {
  ownerLagoLoader = defaultOwnerLagoLoader;
  chargerExistsCheck = defaultChargerExistsCheck;
  customersLoader = defaultCustomersLoader;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function deriveDisplayName(row: CustomerRow): string {
  if (row.name && row.name.trim().length > 0) return row.name;
  if (row.email && row.email.trim().length > 0) return row.email;
  return row.userId;
}

export const handler = define.handlers({
  async GET(ctx) {
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

    let rows: CustomerRow[];
    try {
      rows = await customersLoader();
    } catch (err) {
      log.error("Failed to load customers", {
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

    const customers: CustomerOption[] = rows.map((r) => ({
      lagoCustomerExternalId: r.lagoCustomerExternalId,
      userId: r.userId,
      displayName: deriveDisplayName(r),
      name: r.name,
      email: r.email,
      isOwn: callerLagoId !== null &&
        r.lagoCustomerExternalId === callerLagoId,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    }));

    customers.sort((a, b) => {
      if (a.lastUsedAt && b.lastUsedAt) {
        return a.lastUsedAt < b.lastUsedAt ? 1 : -1;
      }
      if (a.lastUsedAt) return -1;
      if (b.lastUsedAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return jsonResponse(200, {
      customers: customers.slice(0, MAX_CUSTOMERS),
    });
  },
});
