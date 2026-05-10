/**
 * Per-connector spec service. The `charger_connectors` table is the
 * canonical source of truth for connector identity (which connectors
 * exist on a given charger) and connector spec (type + max kW).
 *
 * For unmanaged chargers this table is the only place connectors live.
 * For managed (OCPP) chargers, rows are auto-inserted the first time we
 * observe a `connectorId` via StEvE so admins can edit spec without
 * needing to manually create the row.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { type Db, db as defaultDb } from "../db/index.ts";
import {
  type ChargerConnector,
  chargerConnectors,
  type NewChargerConnector,
} from "../db/schema.ts";

export type ConnectorSpec = {
  connectorType: string | null;
  maxKw: number | null;
};

/**
 * Fetch the lowest-numbered connector's spec for a charger. Used by
 * listing surfaces (homepage chargers card, reservations, sessions) that
 * only display a single rating per row.
 */
export async function getPrimaryConnectorSpec(
  chargeBoxId: string,
  dbh: Db = defaultDb,
): Promise<ConnectorSpec> {
  const [row] = await dbh
    .select({
      connectorType: chargerConnectors.connectorType,
      maxKw: chargerConnectors.maxKw,
    })
    .from(chargerConnectors)
    .where(eq(chargerConnectors.chargeBoxId, chargeBoxId))
    .orderBy(asc(chargerConnectors.connectorId))
    .limit(1);

  if (!row) return { connectorType: null, maxKw: null };
  return {
    connectorType: row.connectorType,
    maxKw: row.maxKw !== null ? Number(row.maxKw) : null,
  };
}

/**
 * Batched primary-spec lookup. Avoids the N+1 problem when listings need
 * specs for many chargers at once. Returns a Map keyed by chargeBoxId;
 * chargers with no rows in `charger_connectors` are absent from the map
 * (callers default to `{ connectorType: null, maxKw: null }`).
 */
export async function getPrimaryConnectorSpecsBatch(
  chargeBoxIds: readonly string[],
  dbh: Db = defaultDb,
): Promise<Map<string, ConnectorSpec>> {
  if (chargeBoxIds.length === 0) return new Map();

  // SELECT DISTINCT ON (charge_box_id) … ORDER BY charge_box_id, connector_id
  // gives us the lowest-numbered connector per charger in one round-trip.
  const rows = await dbh.execute<{
    charge_box_id: string;
    connector_type: string | null;
    max_kw: string | null;
  }>(sql`
    SELECT DISTINCT ON ("charge_box_id")
      "charge_box_id", "connector_type", "max_kw"
    FROM "charger_connectors"
    WHERE "charge_box_id" = ANY(${[...chargeBoxIds]}::text[])
    ORDER BY "charge_box_id", "connector_id"
  `);

  const out = new Map<string, ConnectorSpec>();
  for (const row of rows) {
    out.set(row.charge_box_id, {
      connectorType: row.connector_type,
      maxKw: row.max_kw !== null ? Number(row.max_kw) : null,
    });
  }
  return out;
}

/** All connectors for a charger, ordered by connectorId. */
export async function listConnectors(
  chargeBoxId: string,
  dbh: Db = defaultDb,
): Promise<ChargerConnector[]> {
  return await dbh
    .select()
    .from(chargerConnectors)
    .where(eq(chargerConnectors.chargeBoxId, chargeBoxId))
    .orderBy(asc(chargerConnectors.connectorId));
}

/**
 * Insert a connector row. PK conflict → returns null so the caller can
 * decide whether to surface a 409 or merge.
 */
export async function createConnector(
  input: NewChargerConnector,
  dbh: Db = defaultDb,
): Promise<ChargerConnector | null> {
  const inserted = await dbh
    .insert(chargerConnectors)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? null;
}

/**
 * Fire-and-forget seeding. Used by the loader when StEvE reports a
 * connector we haven't seen yet — we want a row to exist so admins can
 * edit spec, but we don't care about the return value.
 */
export async function ensureConnectorExists(
  chargeBoxId: string,
  connectorId: number,
  dbh: Db = defaultDb,
): Promise<void> {
  await dbh
    .insert(chargerConnectors)
    .values({ chargeBoxId, connectorId })
    .onConflictDoNothing();
}

export async function updateConnectorSpec(
  chargeBoxId: string,
  connectorId: number,
  patch: { connectorType?: string | null; maxKw?: number | null },
  dbh: Db = defaultDb,
): Promise<ChargerConnector | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if ("connectorType" in patch) set.connectorType = patch.connectorType;
  if ("maxKw" in patch) {
    set.maxKw = patch.maxKw !== null && patch.maxKw !== undefined
      ? patch.maxKw.toFixed(2)
      : null;
  }

  const updated = await dbh
    .update(chargerConnectors)
    .set(set)
    .where(
      and(
        eq(chargerConnectors.chargeBoxId, chargeBoxId),
        eq(chargerConnectors.connectorId, connectorId),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export async function deleteConnector(
  chargeBoxId: string,
  connectorId: number,
  dbh: Db = defaultDb,
): Promise<boolean> {
  const deleted = await dbh
    .delete(chargerConnectors)
    .where(
      and(
        eq(chargerConnectors.chargeBoxId, chargeBoxId),
        eq(chargerConnectors.connectorId, connectorId),
      ),
    )
    .returning({ connectorId: chargerConnectors.connectorId });
  return deleted.length > 0;
}
