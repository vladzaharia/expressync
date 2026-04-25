/**
 * POST /api/command-palette/search (Phase P6)
 *
 * Admin-guarded fuzzy search used by `islands/CommandPalette.tsx`. Returns
 * up to 5 matches per entity type. Client debounces the call at 150 ms.
 *
 * Request body: `{ query: string }` — if empty, responds with empty arrays.
 *
 * Response DTO:
 * ```ts
 * {
 *   chargers:      Array<{ id: string; label: string; subtitle?: string; href: string }>,
 *   tags:          Array<...>,
 *   customers:     Array<...>,  // from user_mappings.lago_customer_external_id
 *   invoices:      Array<...>,  // from Lago search (live — opt-in via query match)
 *   reservations:  Array<...>,
 *   syncRuns:      Array<...>,
 * }
 * ```
 *
 * Notes:
 *  - We intentionally search `user_mappings` for customer-ish rows rather than
 *    hammering Lago on every keystroke. Invoice lookup uses Lago's native
 *    `search_term` only when the query is ≥3 chars (latency budget).
 *  - All queries capped to 5 rows via `limit(5)`.
 */

import { define } from "@/utils.ts";
import { db } from "@/src/db/index.ts";
import {
  chargersCache,
  reservations,
  syncedTransactionEvents,
  syncRuns,
  userMappings,
  users,
} from "@/src/db/schema.ts";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { lagoClient } from "@/src/lib/lago-client.ts";
import { logger } from "@/src/lib/utils/logger.ts";

const LIMIT = 5;
const MIN_INVOICE_QUERY_LEN = 3;

export interface CommandSearchHit {
  id: string;
  label: string;
  subtitle?: string;
  href: string;
}

export interface CommandSearchResponse {
  chargers: CommandSearchHit[];
  tags: CommandSearchHit[];
  customers: CommandSearchHit[];
  invoices: CommandSearchHit[];
  reservations: CommandSearchHit[];
  syncRuns: CommandSearchHit[];
  /** Both admin + customer rows from the `users` table. Customer hits link
   *  to a stub `/users/[id]` detail page; admin rows are anchored into the
   *  existing list view (no per-admin detail page yet). */
  users: CommandSearchHit[];
  /** Synced transaction events — search by Steve transaction id (numeric)
   *  or by chargeBoxId. */
  transactions: CommandSearchHit[];
}

const EMPTY: CommandSearchResponse = {
  chargers: [],
  tags: [],
  customers: [],
  invoices: [],
  reservations: [],
  syncRuns: [],
  users: [],
  transactions: [],
};

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: { query?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return jsonOk(EMPTY);
    }

    const like = `%${query}%`;

    // Fire all local DB queries in parallel; swallow per-source errors so a
    // single bad query doesn't blank the whole palette.
    const [
      chargers,
      tags,
      customers,
      reservationsRows,
      syncRunsRows,
      usersRows,
      transactionsRows,
    ] = await Promise.all([
      searchChargers(like).catch((err) => {
        logger.warn("CommandPalette", "chargers search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchTags(like).catch((err) => {
        logger.warn("CommandPalette", "tags search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchCustomers(like).catch((err) => {
        logger.warn("CommandPalette", "customers search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchReservations(like).catch((err) => {
        logger.warn("CommandPalette", "reservations search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchSyncRuns(query).catch((err) => {
        logger.warn("CommandPalette", "sync runs search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchUsers(like).catch((err) => {
        logger.warn("CommandPalette", "users search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchTransactions(query, like).catch((err) => {
        logger.warn("CommandPalette", "transactions search failed", { err });
        return [] as CommandSearchHit[];
      }),
    ]);

    // Invoices via Lago — only on ≥3 chars and best-effort.
    let invoices: CommandSearchHit[] = [];
    if (query.length >= MIN_INVOICE_QUERY_LEN) {
      try {
        const { invoices: list } = await lagoClient.listInvoices({
          searchTerm: query,
          perPage: LIMIT,
          page: 1,
        });
        invoices = list.slice(0, LIMIT).map((inv) => ({
          id: inv.lago_id,
          label: inv.number ?? inv.lago_id,
          subtitle: inv.external_customer_id ?? undefined,
          href: `/invoices/${encodeURIComponent(inv.lago_id)}`,
        }));
      } catch (err) {
        logger.warn("CommandPalette", "invoices search failed", { err });
      }
    }

    return jsonOk({
      chargers,
      tags,
      customers,
      invoices,
      reservations: reservationsRows,
      syncRuns: syncRunsRows,
      users: usersRows,
      transactions: transactionsRows,
    });
  },
});

function jsonOk(payload: CommandSearchResponse): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function searchChargers(like: string): Promise<CommandSearchHit[]> {
  const rows = await db
    .select({
      id: chargersCache.chargeBoxId,
      friendlyName: chargersCache.friendlyName,
      lastStatus: chargersCache.lastStatus,
    })
    .from(chargersCache)
    .where(
      or(
        ilike(chargersCache.chargeBoxId, like),
        ilike(chargersCache.friendlyName, like),
      ),
    )
    .orderBy(desc(chargersCache.lastSeenAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: r.id,
    label: r.friendlyName ?? r.id,
    subtitle: r.friendlyName ? r.id : (r.lastStatus ?? undefined),
    href: `/chargers/${encodeURIComponent(r.id)}`,
  }));
}

async function searchTags(like: string): Promise<CommandSearchHit[]> {
  const rows = await db
    .select({
      pk: userMappings.steveOcppTagPk,
      idTag: userMappings.steveOcppIdTag,
      displayName: userMappings.displayName,
      tagType: userMappings.tagType,
    })
    .from(userMappings)
    .where(
      or(
        ilike(userMappings.steveOcppIdTag, like),
        ilike(userMappings.displayName, like),
      ),
    )
    .orderBy(desc(userMappings.updatedAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: String(r.pk),
    label: r.displayName ?? r.idTag,
    subtitle: r.displayName ? r.idTag : (r.tagType ?? undefined),
    href: `/tags/${encodeURIComponent(String(r.pk))}`,
  }));
}

async function searchCustomers(like: string): Promise<CommandSearchHit[]> {
  // We query `user_mappings` — the cache of Lago customers we actually
  // operate on. Avoids hitting the Lago API per keystroke.
  const rows = await db
    .select({
      id: userMappings.lagoCustomerExternalId,
      displayName: userMappings.displayName,
      subscriptionId: userMappings.lagoSubscriptionExternalId,
    })
    .from(userMappings)
    .where(
      sql`${userMappings.lagoCustomerExternalId} IS NOT NULL AND (
        ${userMappings.lagoCustomerExternalId} ILIKE ${like}
        OR ${userMappings.displayName} ILIKE ${like}
        OR ${userMappings.lagoSubscriptionExternalId} ILIKE ${like}
      )`,
    )
    .orderBy(desc(userMappings.updatedAt))
    .limit(LIMIT);

  return rows
    .filter((
      r,
    ): r is {
      id: string;
      displayName: string | null;
      subscriptionId: string | null;
    } => typeof r.id === "string" && r.id.length > 0)
    .map((r) => ({
      id: r.id,
      label: r.displayName ?? r.id,
      subtitle: r.subscriptionId ?? r.id,
      href: r.subscriptionId
        ? `/subscriptions/${encodeURIComponent(r.subscriptionId)}/profile`
        : `/links?customerId=${encodeURIComponent(r.id)}`,
    }));
}

async function searchReservations(like: string): Promise<CommandSearchHit[]> {
  const rows = await db
    .select({
      id: reservations.id,
      chargeBoxId: reservations.chargeBoxId,
      connectorId: reservations.connectorId,
      idTag: reservations.steveOcppIdTag,
      startAt: reservations.startAt,
      status: reservations.status,
    })
    .from(reservations)
    .where(
      or(
        ilike(reservations.chargeBoxId, like),
        ilike(reservations.steveOcppIdTag, like),
        ilike(reservations.status, like),
      ),
    )
    .orderBy(desc(reservations.startAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: String(r.id),
    label: `${r.chargeBoxId} · conn ${r.connectorId}`,
    subtitle: `${r.status} · ${r.idTag}`,
    href: `/reservations/${r.id}`,
  }));
}

async function searchUsers(like: string): Promise<CommandSearchHit[]> {
  // Search across both admin + customer rows. Admin hits anchor into the
  // existing /admin/users list (no per-admin detail page); customer hits
  // route to /admin/users/[id] which is the new detail page added alongside
  // this search expansion.
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(
      or(
        ilike(users.email, like),
        ilike(users.name, like),
      ),
    )
    .orderBy(desc(users.updatedAt))
    .limit(LIMIT);

  return rows.map((r) => {
    const label = (r.name && r.name.trim()) || r.email || `User ${r.id}`;
    const subtitle = r.name && r.email
      ? `${r.email} · ${r.role}`
      : (r.email ?? r.role);
    return {
      id: r.id,
      label,
      subtitle,
      href: r.role === "admin"
        ? `/users#${encodeURIComponent(r.id)}`
        : `/users/${encodeURIComponent(r.id)}`,
    };
  });
}

async function searchTransactions(
  query: string,
  _like: string,
): Promise<CommandSearchHit[]> {
  // Only the numeric Steve transaction id is in the local cache. A
  // chargeBoxId-keyed transaction search would require joining StEvE,
  // which is too expensive on the keystroke path; chargers themselves
  // are already searchable separately.
  const idNum = Number.parseInt(query, 10);
  if (Number.isNaN(idNum)) return [];
  const rows = await db
    .selectDistinctOn([syncedTransactionEvents.steveTransactionId], {
      id: syncedTransactionEvents.steveTransactionId,
      isFinal: syncedTransactionEvents.isFinal,
      kwhDelta: syncedTransactionEvents.kwhDelta,
    })
    .from(syncedTransactionEvents)
    .where(eq(syncedTransactionEvents.steveTransactionId, idNum))
    .orderBy(
      syncedTransactionEvents.steveTransactionId,
      desc(syncedTransactionEvents.syncedAt),
    )
    .limit(LIMIT);

  return rows.map((r) => ({
    id: String(r.id),
    label: `Transaction #${r.id}`,
    subtitle: `${r.kwhDelta ?? "0"} kWh${
      r.isFinal ? " · finalized" : " · in progress"
    }`,
    href: `/transactions/${r.id}`,
  }));
}

async function searchSyncRuns(query: string): Promise<CommandSearchHit[]> {
  // Sync runs are keyed by an integer id + status; match those directly.
  const idNum = Number.parseInt(query, 10);
  const conds = [];
  if (!Number.isNaN(idNum)) conds.push(eq(syncRuns.id, idNum));
  conds.push(ilike(syncRuns.status, `%${query}%`));

  const rows = await db
    .select({
      id: syncRuns.id,
      status: syncRuns.status,
      startedAt: syncRuns.startedAt,
      transactionsProcessed: syncRuns.transactionsProcessed,
    })
    .from(syncRuns)
    .where(or(...conds))
    .orderBy(desc(syncRuns.startedAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: String(r.id),
    label: `Sync run #${r.id}`,
    subtitle: `${r.status} · ${r.transactionsProcessed ?? 0} txns`,
    href: `/sync/${r.id}`,
  }));
}
