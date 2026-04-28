/**
 * Customer meta-tag helpers — Slice S.
 *
 * Polaris models every Lago customer with a single "parent" OCPP tag in
 * StEvE: `OCPP-{externalId}`. Real per-card mappings carry that string in
 * their `parent_id_tag` column; an admin RemoteStart that targets a
 * customer (rather than a specific card) uses the parent tag directly so
 * StEvE's tag-hierarchy resolves to whichever child cards are active.
 *
 * Slice S resolves the customer picker into one of these parent tags. The
 * parallel team owns the full webhook + sync upkeep for these meta-tags;
 * this module is a defensive minimum so the picker flow lands even if the
 * parallel team's helper isn't merged yet:
 *
 *   - `parentIdTagFor(externalId)` — pure deterministic string builder.
 *   - `ensureCustomerMetaTag(externalId, displayName?)` — best-effort
 *     idempotent upsert in StEvE. If the parallel team's full
 *     implementation lands, replace this stub; the call sites are
 *     idempotent so a more thorough implementation drops in cleanly.
 */

import { logger } from "./utils/logger.ts";
import { steveClient } from "./steve-client.ts";

const log = logger.child("CustomerMetaTags");

/**
 * Deterministic mapping from a Lago customer's `external_id` to its
 * managed OCPP parent tag in StEvE.
 *
 * Pure function — no I/O. Always returns the canonical `OCPP-{externalId}`
 * shape regardless of whether the tag actually exists in StEvE yet (use
 * `ensureCustomerMetaTag` to materialize it).
 */
export function parentIdTagFor(externalId: string): string {
  return `OCPP-${externalId}`;
}

/**
 * Idempotent best-effort create/upsert of the `OCPP-{externalId}` parent
 * tag in StEvE. Safe to call on every RemoteStart — if the tag already
 * exists, this is a no-op.
 *
 * Failure here is not fatal to the caller: we log and swallow so a flaky
 * StEvE doesn't block a remote-start that would otherwise resolve via an
 * already-existing tag. The OCPP RemoteStart call downstream will fail
 * cleanly (StEvE's own auth) if the parent really is missing.
 *
 * Replace with the parallel team's full helper when it lands; the
 * signature and idempotency contract are intentionally identical so call
 * sites don't need to change.
 */
export async function ensureCustomerMetaTag(
  externalId: string,
  displayName?: string,
): Promise<{ idTag: string; ocppTagPk: number | null }> {
  const idTag = parentIdTagFor(externalId);

  try {
    const existing = await steveClient.getOcppTags({ idTag });
    if (existing.length > 0) {
      return { idTag, ocppTagPk: existing[0].ocppTagPk };
    }
  } catch (err) {
    log.warn("getOcppTags lookup failed; will attempt create anyway", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const created = await steveClient.createOcppTag(idTag, {
      note: displayName
        ? `Polaris customer parent — ${displayName}`
        : "Polaris customer parent",
      maxActiveTransactionCount: 1,
    });
    return { idTag, ocppTagPk: created.ocppTagPk };
  } catch (err) {
    log.warn("createOcppTag failed; assuming tag may already exist", {
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
    return { idTag, ocppTagPk: null };
  }
}
