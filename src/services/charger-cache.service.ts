import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db as defaultDb } from "../db/index.ts";
import { chargersCache, type NewChargerCache } from "../db/schema.ts";
import { steveClient } from "../lib/steve-client.ts";
import { logger } from "../lib/utils/logger.ts";

/**
 * Thin structural alias — the service accepts either the default `db` or
 * any Drizzle postgres-js instance (useful for tests).
 */
// deno-lint-ignore no-explicit-any
type Db = PostgresJsDatabase<any>;

interface SeenRow {
  chargeBoxId: string;
  chargeBoxPk: number | null;
}

/**
 * Collect known chargers from StEvE transactions (via the getChargeBoxes
 * workaround) and from `charger_operation_log` (Phase A), merging by
 * `charge_box_id`. Deliberately resilient: if the operation log table
 * doesn't exist yet, the sync loop still succeeds.
 */
async function collectSeenChargers(dbh: Db): Promise<Map<string, SeenRow>> {
  const seen = new Map<string, SeenRow>();

  // From StEvE transactions (existing workaround)
  try {
    const chargeBoxes = await steveClient.getChargeBoxes();
    for (const cb of chargeBoxes) {
      seen.set(cb.chargeBoxId, {
        chargeBoxId: cb.chargeBoxId,
        chargeBoxPk: cb.chargeBoxPk,
      });
    }
  } catch (error) {
    logger.warn("ChargerCache", "Failed to fetch chargers from StEvE", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // From charger_operation_log (Phase A). The table may not exist yet; treat
  // its absence as empty.
  try {
    const rows = await dbh.execute<{ charge_box_id: string }>(
      sql`SELECT DISTINCT charge_box_id FROM charger_operation_log WHERE charge_box_id IS NOT NULL`,
    );
    // postgres-js + drizzle returns an array-like result
    const list = Array.isArray(rows)
      ? rows
      : (rows as { rows?: unknown[] }).rows ?? [];
    for (const row of list as { charge_box_id: string }[]) {
      if (!row?.charge_box_id) continue;
      if (!seen.has(row.charge_box_id)) {
        seen.set(row.charge_box_id, {
          chargeBoxId: row.charge_box_id,
          chargeBoxPk: null,
        });
      }
    }
  } catch (error) {
    logger.debug(
      "ChargerCache",
      "charger_operation_log not available yet (Phase A not deployed?)",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return seen;
}

/**
 * Refresh the sticky chargers_cache table.
 *
 * For each charger we observe (from StEvE transactions + operation log):
 * - INSERT if missing (sets first_seen_at = now())
 * - UPDATE last_seen_at = now() and charge_box_pk if we have one
 *
 * Existing cache rows that are no longer "seen" are left alone — we want
 * stale chargers to remain visible in the UI (with an Offline badge) rather
 * than disappear. Called at the end of every sync run.
 */
export async function refreshChargerCache(dbh: Db = defaultDb): Promise<{
  upserted: number;
}> {
  const seen = await collectSeenChargers(dbh);

  if (seen.size === 0) {
    logger.debug("ChargerCache", "No chargers seen this run; cache unchanged");
    return { upserted: 0 };
  }

  // Look up the operator-provided friendly name (charge_box.description
  // in SteVe). The forked SteVe REST endpoint /v1/chargeBoxes returns
  // it; vanilla SteVe would 404 and the call falls back to a description-
  // less list, in which case friendly_name stays whatever it was.
  let descByChargeBoxId = new Map<string, string | null>();
  try {
    const { steveClient } = await import("../lib/steve-client.ts");
    const boxes = await steveClient.getChargeBoxes();
    for (const b of boxes) {
      const trimmed = (b.description ?? "").trim();
      descByChargeBoxId.set(b.chargeBoxId, trimmed === "" ? null : trimmed);
    }
  } catch (err) {
    logger.warn("ChargerCache", "Failed to fetch chargeBox descriptions", {
      error: err instanceof Error ? err.message : String(err),
    });
    descByChargeBoxId = new Map();
  }

  const values: NewChargerCache[] = Array.from(seen.values()).map((row) => ({
    chargeBoxId: row.chargeBoxId,
    chargeBoxPk: row.chargeBoxPk ?? null,
    friendlyName: descByChargeBoxId.get(row.chargeBoxId) ?? null,
  }));

  await dbh
    .insert(chargersCache)
    .values(values)
    .onConflictDoUpdate({
      target: chargersCache.chargeBoxId,
      set: {
        // Only overwrite charge_box_pk when we have a fresh non-null value.
        chargeBoxPk:
          sql`COALESCE(EXCLUDED.charge_box_pk, ${chargersCache.chargeBoxPk})`,
        // friendly_name: replace with whatever SteVe currently has,
        // including null if the operator cleared the description. The
        // SteVe-side description is the source of truth.
        friendlyName: sql`EXCLUDED.friendly_name`,
        lastSeenAt: sql`now()`,
      },
    });

  logger.info("ChargerCache", "Charger cache refreshed", {
    upserted: values.length,
  });
  return { upserted: values.length };
}

/**
 * Record a fresh status reading for a charger.
 *
 * Called by the code that handles a successful TriggerMessage(StatusNotification)
 * response, or whenever we otherwise receive a real status for a charger.
 * Upserts the row so it also acts as a first-seen record if we've never
 * tracked this charger before.
 */
export async function recordChargerStatus(
  dbh: Db,
  chargeBoxId: string,
  status: string,
): Promise<void> {
  await dbh
    .insert(chargersCache)
    .values({
      chargeBoxId,
      lastStatus: status,
      lastStatusAt: new Date(),
    })
    .onConflictDoUpdate({
      target: chargersCache.chargeBoxId,
      set: {
        lastStatus: status,
        lastStatusAt: sql`now()`,
        lastSeenAt: sql`now()`,
      },
    });

  logger.debug("ChargerCache", "Charger status recorded", {
    chargeBoxId,
    status,
  });
}
