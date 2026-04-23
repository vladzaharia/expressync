/**
 * POST /api/customer/command-palette/search (Polaris Track H)
 *
 * Customer-scoped fuzzy search powering the customer-surface ⌘K palette.
 * Returns up to 5 matches per entity type, scoped to entities the
 * authenticated user actually owns via `resolveCustomerScope`. Empty scope
 * (no mappings → e.g. an admin landing on the customer surface without
 * impersonation) short-circuits to empty arrays — never an error.
 *
 * Request body: `{ query: string }` — empty string responds with empty arrays.
 *
 * Response DTO mirrors the admin search shape (`CommandSearchResponse`)
 * minus the customer/charger/sync entities that aren't customer-relevant.
 * The shared TypeScript type lives next to the admin endpoint and is
 * structurally re-used here so the palette island doesn't need to branch
 * on shape.
 */

import { define } from "@/utils.ts";
import { db } from "@/src/db/index.ts";
import {
  reservations,
  syncedTransactionEvents,
  userMappings,
} from "@/src/db/schema.ts";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { lagoClient } from "@/src/lib/lago-client.ts";
import { resolveCustomerScope } from "@/src/lib/scoping.ts";
import { logger } from "@/src/lib/utils/logger.ts";
import type {
  CommandSearchHit,
  CommandSearchResponse,
} from "@/routes/api/admin/command-palette/search.ts";

const LIMIT = 5;
const MIN_INVOICE_QUERY_LEN = 3;

const EMPTY: CommandSearchResponse = {
  chargers: [],
  tags: [],
  customers: [],
  invoices: [],
  reservations: [],
  syncRuns: [],
};

export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return jsonOk(EMPTY); // unauthenticated → silently empty
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
    if (!query) return jsonOk(EMPTY);

    const scope = await resolveCustomerScope(ctx);
    // Empty scope → no owned entities to search. Returning empty here
    // keeps the palette responsive (no spinner stuck) without exposing a
    // 4xx that would suggest the endpoint is broken.
    if (
      scope.mappingIds.length === 0 &&
      scope.ocppTagPks.length === 0 &&
      !scope.lagoCustomerExternalId
    ) {
      return jsonOk(EMPTY);
    }

    const like = `%${query}%`;

    // Local DB queries in parallel; per-source errors swallowed so one
    // bad query doesn't blank the whole palette (mirrors the admin path).
    //
    // Sessions search is collected but not surfaced in the response yet —
    // the admin response shape doesn't carry a `sessions` slot, and
    // wedging owned sessions into another bucket muddles the chrome. The
    // dedicated "My sessions" group lands in Track G1 alongside the
    // dashboard. For MVP the static action commands ("My sessions" /
    // "My reservations" / "My invoices") cover the search-less nav case.
    const [tags, _sessionsHits, reservationsHits] = await Promise.all([
      searchOwnedTags(like, scope.mappingIds).catch((err) => {
        logger.warn("CustomerCommandPalette", "tags search failed", { err });
        return [] as CommandSearchHit[];
      }),
      searchOwnedSessions(like, scope.mappingIds).catch((err) => {
        logger.warn("CustomerCommandPalette", "sessions search failed", {
          err,
        });
        return [] as CommandSearchHit[];
      }),
      searchOwnedReservations(like, scope.ocppTagPks).catch((err) => {
        logger.warn("CustomerCommandPalette", "reservations search failed", {
          err,
        });
        return [] as CommandSearchHit[];
      }),
    ]);

    // Lago invoice search — scoped to the customer's external_customer_id.
    // Only fires for queries ≥3 chars to stay within the latency budget.
    let invoices: CommandSearchHit[] = [];
    if (
      scope.lagoCustomerExternalId &&
      query.length >= MIN_INVOICE_QUERY_LEN
    ) {
      try {
        const { invoices: list } = await lagoClient.listInvoices({
          externalCustomerId: scope.lagoCustomerExternalId,
          searchTerm: query,
          perPage: LIMIT,
          page: 1,
        });
        invoices = list.slice(0, LIMIT).map((inv) => ({
          id: inv.lago_id,
          label: inv.number ?? inv.lago_id,
          // Customer-friendly subtitle — just the issuing date if present.
          subtitle: inv.issuing_date ?? undefined,
          href: `/billing/invoices/${encodeURIComponent(inv.lago_id)}`,
        }));
      } catch (err) {
        logger.warn("CustomerCommandPalette", "invoices search failed", {
          err,
        });
      }
    }

    return jsonOk({
      chargers: [], // customer surface doesn't browse chargers globally
      tags, // "Cards" entity for the customer
      customers: [], // self-only — not searchable
      invoices,
      reservations: reservationsHits,
      syncRuns: [], // admin-only operational concept
    });
  },
});

function jsonOk(payload: CommandSearchResponse): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Search the customer's own user_mappings ("cards" in customer copy).
 *
 * Filters to the scope's mapping IDs so an admin probing this endpoint
 * with `?as=` impersonation only ever sees the impersonated customer's
 * cards.
 */
async function searchOwnedTags(
  like: string,
  mappingIds: number[],
): Promise<CommandSearchHit[]> {
  if (mappingIds.length === 0) return [];
  const rows = await db
    .select({
      pk: userMappings.steveOcppTagPk,
      idTag: userMappings.steveOcppIdTag,
      displayName: userMappings.displayName,
      tagType: userMappings.tagType,
    })
    .from(userMappings)
    .where(
      and(
        inArray(userMappings.id, mappingIds),
        or(
          ilike(userMappings.steveOcppIdTag, like),
          ilike(userMappings.displayName, like),
        ),
      ),
    )
    .orderBy(desc(userMappings.updatedAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: String(r.pk),
    label: r.displayName ?? r.idTag,
    subtitle: r.displayName ? r.idTag : (r.tagType ?? undefined),
    // Customer surface uses /cards/<mapping-pk> — same scheme as the
    // listing pages.
    href: `/cards/${encodeURIComponent(String(r.pk))}`,
  }));
}

/**
 * Search synced_transaction_events scoped to the user's mappings.
 *
 * The query is fuzzy-matched against the underlying tag's `idTag` /
 * displayName so e.g. searching for "garage" surfaces every session
 * charged on the "garage tag" mapping. Numeric query → also matches the
 * raw transaction id.
 */
async function searchOwnedSessions(
  like: string,
  mappingIds: number[],
): Promise<CommandSearchHit[]> {
  if (mappingIds.length === 0) return [];
  const rows = await db
    .select({
      id: syncedTransactionEvents.id,
      kwh: syncedTransactionEvents.kwhDelta,
      isFinal: syncedTransactionEvents.isFinal,
      tagDisplayName: userMappings.displayName,
      tagIdTag: userMappings.steveOcppIdTag,
    })
    .from(syncedTransactionEvents)
    .leftJoin(
      userMappings,
      eq(syncedTransactionEvents.userMappingId, userMappings.id),
    )
    .where(
      and(
        inArray(syncedTransactionEvents.userMappingId, mappingIds),
        or(
          ilike(userMappings.steveOcppIdTag, like),
          ilike(userMappings.displayName, like),
        ),
      ),
    )
    .orderBy(desc(syncedTransactionEvents.syncedAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: String(r.id),
    label: `Session #${r.id}`,
    subtitle: `${r.kwh ?? "—"} kWh · ${r.tagDisplayName ?? r.tagIdTag ?? ""}`,
    href: `/sessions/${r.id}`,
  }));
}

/**
 * Search the user's own reservations.
 *
 * Filters by `steveOcppTagPk ∈ scope.ocppTagPks`. Match against
 * `chargeBoxId` + `status` strings.
 */
async function searchOwnedReservations(
  like: string,
  ocppTagPks: number[],
): Promise<CommandSearchHit[]> {
  if (ocppTagPks.length === 0) return [];
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
      and(
        inArray(reservations.steveOcppTagPk, ocppTagPks),
        or(
          ilike(reservations.chargeBoxId, like),
          ilike(reservations.steveOcppIdTag, like),
          ilike(reservations.status, like),
        ),
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
