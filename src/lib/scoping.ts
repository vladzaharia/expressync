/**
 * Polaris Track A — customer ownership scoping.
 *
 * Single source of truth for "what does this customer own / can act on".
 * Every customer-facing endpoint MUST consult `resolveCustomerScope()`
 * (memoized on the request context) and `assertOwnership()` before
 * touching any cross-customer data.
 *
 * Scope resolution:
 *   - Reads `user_mappings` for `user_id = ctx.state.actingAs ?? ctx.state.user.id`
 *   - Returns the full set of (lago_customer_external_id, ocpp_tag_pks,
 *     mapping_ids) plus a derived `isActive` boolean.
 *   - Memoizes on `ctx.state.customerScope` so repeated calls in the same
 *     request hit RAM, not the DB.
 *
 * Ownership assertions:
 *   - Throw `OwnershipError` (status 404 — never 403, to avoid information
 *     leakage). Customer A asking for customer B's session id must look
 *     identical to "id doesn't exist".
 *
 * Convention: handlers should import `assertOwnership` and call it at the
 * top of every dynamic-id handler. Bare access via `ctx.params.id` without
 * a preceding `assertOwnership()` call is a CI lint violation (rule lives
 * in a future track).
 */

import { eq, inArray } from "drizzle-orm";
import type { FreshContext } from "fresh";
import { db } from "../db/index.ts";
import {
  reservations,
  syncedTransactionEvents,
  userMappings,
} from "../db/schema.ts";
import type { CustomerScope, State } from "@/utils.ts";

/** Scope key types accepted by `assertOwnership`. */
export type OwnedResourceType =
  | "session" // synced_transaction_events.id
  | "reservation" // reservations.id
  | "invoice" // Lago invoice id (string)
  | "card" // user_mappings.id (the customer's own card)
  | "mapping"; // user_mappings.id (synonym for card — admin terminology)

/**
 * Thrown when the caller doesn't own the requested resource. Mapped to a
 * 404 response to avoid enumeration via 403-vs-404 oracle.
 */
export class OwnershipError extends Error {
  readonly status = 404;
  constructor(
    public type: OwnedResourceType,
    public id: string | number,
  ) {
    super(`Resource ${type}#${id} not owned by current scope`);
    this.name = "OwnershipError";
  }
}

/** Ctx subset used by scoping helpers. Keeping the surface narrow makes tests trivial. */
export interface ScopingContext {
  state: State;
}

/**
 * Resolve and memoize the active customer scope for this request.
 *
 * Idempotent: subsequent calls return the cached value from
 * `ctx.state.customerScope`. Returns an empty/inactive scope for users with
 * no mappings (admins viewing the customer surface fall in this bucket).
 *
 * The "effective user id" honors impersonation: if `ctx.state.actingAs` is
 * set (admin "view as customer"), scope resolves against that customer; the
 * admin's own id is never used in scoping queries during impersonation.
 */
export async function resolveCustomerScope(
  ctx: ScopingContext | FreshContext<State>,
): Promise<CustomerScope> {
  const state = ctx.state as State;
  if (state.customerScope) return state.customerScope;

  const effectiveUserId = state.actingAs ?? state.user?.id;
  if (!effectiveUserId) {
    // No session, or admin without impersonation. Return empty scope so
    // downstream filters short-circuit to zero rows.
    const empty: CustomerScope = {
      lagoCustomerExternalId: null,
      ocppTagPks: [],
      mappingIds: [],
      isActive: false,
    };
    state.customerScope = empty;
    return empty;
  }

  const rows = await db
    .select({
      id: userMappings.id,
      steveOcppTagPk: userMappings.steveOcppTagPk,
      lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
      isActive: userMappings.isActive,
    })
    .from(userMappings)
    .where(eq(userMappings.userId, effectiveUserId));

  // Derive aggregate fields. lagoCustomerExternalId is the same across all
  // mappings owned by a given user (enforced by trigger 0026), so picking
  // the first non-null value is safe and intentional.
  const lagoIds = new Set<string>();
  const ocppTagPks: number[] = [];
  const mappingIds: number[] = [];
  let anyActive = false;
  for (const r of rows) {
    if (r.lagoCustomerExternalId) lagoIds.add(r.lagoCustomerExternalId);
    ocppTagPks.push(r.steveOcppTagPk);
    mappingIds.push(r.id);
    if (r.isActive) anyActive = true;
  }
  const lagoCustomerExternalId = lagoIds.size > 0 ? [...lagoIds][0] : null;

  const scope: CustomerScope = {
    lagoCustomerExternalId,
    ocppTagPks,
    mappingIds,
    isActive: anyActive,
  };
  state.customerScope = scope;
  return scope;
}

/**
 * Assert that a resource is owned by the current customer scope.
 *
 *   - `session`     → joins through synced_transaction_events.user_mapping_id
 *   - `reservation` → checks reservations.steve_ocpp_tag_pk ∈ scope
 *   - `invoice`     → checks Lago `external_customer_id` matches
 *   - `card` /
 *     `mapping`     → checks user_mappings.id ∈ scope.mappingIds
 *
 * Throws `OwnershipError` (status 404) on miss. Returns void on success.
 */
export async function assertOwnership(
  ctx: ScopingContext | FreshContext<State>,
  type: OwnedResourceType,
  id: string | number,
): Promise<void> {
  const scope = await resolveCustomerScope(ctx);

  switch (type) {
    case "session": {
      const numericId = typeof id === "string" ? parseInt(id, 10) : id;
      if (!Number.isFinite(numericId)) throw new OwnershipError(type, id);
      if (scope.mappingIds.length === 0) throw new OwnershipError(type, id);
      const [row] = await db
        .select({ id: syncedTransactionEvents.id })
        .from(syncedTransactionEvents)
        .where(eq(syncedTransactionEvents.id, numericId))
        .limit(1);
      if (!row) throw new OwnershipError(type, id);
      // We've fetched the row — confirm its mapping is in scope.
      const [withMapping] = await db
        .select({
          mappingId: syncedTransactionEvents.userMappingId,
        })
        .from(syncedTransactionEvents)
        .where(eq(syncedTransactionEvents.id, numericId))
        .limit(1);
      if (
        !withMapping?.mappingId ||
        !scope.mappingIds.includes(withMapping.mappingId)
      ) {
        throw new OwnershipError(type, id);
      }
      return;
    }
    case "reservation": {
      const numericId = typeof id === "string" ? parseInt(id, 10) : id;
      if (!Number.isFinite(numericId)) throw new OwnershipError(type, id);
      if (scope.ocppTagPks.length === 0) throw new OwnershipError(type, id);
      const [row] = await db
        .select({ tagPk: reservations.steveOcppTagPk })
        .from(reservations)
        .where(eq(reservations.id, numericId))
        .limit(1);
      if (!row || !scope.ocppTagPks.includes(row.tagPk)) {
        throw new OwnershipError(type, id);
      }
      return;
    }
    case "invoice": {
      // Lago-side ownership: scope.lagoCustomerExternalId must be set, and
      // the invoice's `external_customer_id` must match. Actual fetch is
      // done by the caller (handler still needs the Lago payload); this
      // helper only enforces that scope claims ownership of the customer id.
      // Caller must compare `invoice.external_customer_id === scope.lagoCustomerExternalId`.
      // We require a non-empty scope to pass; the handler then performs the
      // string comparison after fetching from Lago.
      if (!scope.lagoCustomerExternalId) {
        throw new OwnershipError(type, id);
      }
      // The actual id-vs-customer match happens at the call site after the
      // Lago fetch. Throw a useful error here only when scope is empty.
      return;
    }
    case "card":
    case "mapping": {
      const numericId = typeof id === "string" ? parseInt(id, 10) : id;
      if (!Number.isFinite(numericId)) throw new OwnershipError(type, id);
      if (!scope.mappingIds.includes(numericId)) {
        throw new OwnershipError(type, id);
      }
      return;
    }
  }
}

/**
 * Drizzle helper: returns a scoped query builder pre-filtered by the
 * caller's scope. Currently supports the two most common joins; extend
 * as more customer-facing handlers land.
 */
export async function customerScopedQuery<
  T extends "sessions" | "reservations" | "mappings",
>(
  ctx: ScopingContext | FreshContext<State>,
  table: T,
): Promise<{
  scope: CustomerScope;
  /**
   * The list of values you should pass to `inArray()` for the standard
   * ownership filter. Empty list → handler should short-circuit and return
   * zero rows.
   */
  filterValues: number[];
  /** Sugar — pre-built `inArray` predicate keyed on the right column. */
  // deno-lint-ignore no-explicit-any
  predicate: any | null;
}> {
  const scope = await resolveCustomerScope(ctx);
  if (table === "sessions") {
    if (scope.mappingIds.length === 0) {
      return { scope, filterValues: [], predicate: null };
    }
    return {
      scope,
      filterValues: scope.mappingIds,
      predicate: inArray(
        syncedTransactionEvents.userMappingId,
        scope.mappingIds,
      ),
    };
  }
  if (table === "reservations") {
    if (scope.ocppTagPks.length === 0) {
      return { scope, filterValues: [], predicate: null };
    }
    return {
      scope,
      filterValues: scope.ocppTagPks,
      predicate: inArray(
        reservations.steveOcppTagPk,
        scope.ocppTagPks,
      ),
    };
  }
  // table === "mappings"
  if (scope.mappingIds.length === 0) {
    return { scope, filterValues: [], predicate: null };
  }
  return {
    scope,
    filterValues: scope.mappingIds,
    predicate: inArray(userMappings.id, scope.mappingIds),
  };
}
