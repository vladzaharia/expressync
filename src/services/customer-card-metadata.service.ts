/**
 * Customer card metadata sync.
 *
 * Lago OSS v1.45 does NOT expose a REST API for managing invoice custom
 * sections (only the dashboard UI creates/edits them). The workable
 * dynamic-content surface is **customer metadata with `display_in_invoice:
 * true`**, which Lago renders on invoice PDFs.
 *
 * This service mirrors rows from `issued_cards` (the non-skipped ones) into
 * a customer's Lago metadata. On every card issuance (or manual resync), we
 *   1. gather all `issued_cards` for every mapping under that Lago customer,
 *   2. build metadata entries (one per issued card, keyed `card_<n>`), and
 *   3. PUT the customer with the merged metadata array.
 *
 * Lago PUT /customers replaces the metadata array wholesale; non-card
 * entries present on the customer are preserved by this routine.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { issuedCards, userMappings } from "../db/schema.ts";
import { lagoClient } from "../lib/lago-client.ts";
import { logger } from "../lib/utils/logger.ts";
import { isMetaTag } from "../lib/tag-hierarchy.ts";

const log = logger.child("CustomerCardMetadata");

/** Lago metadata entry shape accepted by PUT /customers. */
interface CustomerMetadataInput {
  id?: string;
  key: string;
  value: string;
  display_in_invoice?: boolean;
}

/** Prefix used on metadata keys we own. Non-prefixed keys are preserved. */
const CARD_KEY_PREFIX = "card_";

/** Lago max metadata entries per customer (per Lago docs). */
const MAX_METADATA_ENTRIES = 20;

const CARD_TYPE_LABELS: Record<string, string> = {
  ev_card: "EV Card",
  keytag: "Keytag",
  sticker: "Sticker",
};

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatMetadataValue(row: {
  cardType: string;
  billingMode: string;
  issuedAt: Date;
  note: string | null;
}): string {
  const typeLabel = CARD_TYPE_LABELS[row.cardType] ?? row.cardType;
  const date = formatIsoDate(row.issuedAt);
  const priceHint = row.billingMode === "charged"
    ? "$3"
    : row.billingMode === "no_cost"
    ? "free"
    : "local-only";
  const base = `${typeLabel} ${date} ${priceHint}`;
  // Lago caps value length; truncate to stay well under limit.
  return base.slice(0, 40);
}

/**
 * Resync customer metadata for a given Lago customer.
 *
 * Safe to call repeatedly — idempotent relative to `issued_cards` state.
 * Only mutates Lago if the target metadata array differs from what Lago
 * currently holds (avoids noisy PUTs).
 *
 * @returns true if a PUT was issued, false otherwise.
 */
export async function syncCustomerCardMetadata(
  lagoCustomerExternalId: string,
): Promise<boolean> {
  // 1. Find every non-meta mapping under this customer. Meta-tags (e.g.
  //    `OCPP-VLAD`) are hierarchy-rollup parents — they never correspond to
  //    a physical card and must not surface on customer invoices.
  const mappings = await db
    .select({
      id: userMappings.id,
      steveOcppIdTag: userMappings.steveOcppIdTag,
    })
    .from(userMappings)
    .where(eq(userMappings.lagoCustomerExternalId, lagoCustomerExternalId));
  const mappingIds = mappings
    .filter((m) => !isMetaTag(m.steveOcppIdTag))
    .map((m) => m.id);
  if (mappingIds.length === 0) {
    log.debug("No non-meta mappings for customer; skipping metadata sync", {
      lagoCustomerExternalId,
      totalMappings: mappings.length,
    });
    return false;
  }

  // 2. Collect all issued cards for those mappings, excluding skipped_sync
  //    (those are local-only and shouldn't show on an invoice).
  const cards = await db
    .select({
      id: issuedCards.id,
      cardType: issuedCards.cardType,
      billingMode: issuedCards.billingMode,
      issuedAt: issuedCards.issuedAt,
      note: issuedCards.note,
    })
    .from(issuedCards)
    .where(inArray(issuedCards.userMappingId, mappingIds));

  const visibleCards = cards
    .filter((c) => c.billingMode !== "skipped_sync")
    .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());

  // 3. Build fresh card metadata entries.
  const cardEntries: CustomerMetadataInput[] = visibleCards.map((c, idx) => ({
    key: `${CARD_KEY_PREFIX}${idx + 1}`,
    value: formatMetadataValue(c),
    display_in_invoice: true,
  }));

  // 4. Fetch current customer metadata, preserve non-card entries.
  let existing: CustomerMetadataInput[] = [];
  try {
    const { customer } = await lagoClient.getCustomer(lagoCustomerExternalId);
    const rawMeta = (customer as unknown as { metadata?: unknown }).metadata;
    if (Array.isArray(rawMeta)) {
      existing = rawMeta
        .filter(
          (m): m is Record<string, unknown> =>
            typeof m === "object" && m !== null,
        )
        .map((m) => ({
          id: typeof m.id === "string" ? m.id : undefined,
          key: String(m.key ?? ""),
          value: String(m.value ?? ""),
          display_in_invoice: m.display_in_invoice === true,
        }));
    }
  } catch (err) {
    log.error("Failed to fetch customer for metadata sync", {
      lagoCustomerExternalId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const nonCardEntries = existing.filter(
    (m) => !m.key.startsWith(CARD_KEY_PREFIX),
  );
  const merged = [...nonCardEntries, ...cardEntries].slice(
    0,
    MAX_METADATA_ENTRIES,
  );

  // 5. Bail if nothing changed — avoid noisy PUTs.
  if (metadataArraysEqual(existing, merged)) {
    log.debug("Customer metadata already in sync; no PUT needed", {
      lagoCustomerExternalId,
      entryCount: merged.length,
    });
    return false;
  }

  // 6. PUT the merged array.
  try {
    await lagoClient.updateCustomer(lagoCustomerExternalId, {
      metadata: merged,
    });
    log.info("Customer metadata synced", {
      lagoCustomerExternalId,
      cardEntryCount: cardEntries.length,
      totalMetadataCount: merged.length,
    });
    return true;
  } catch (err) {
    log.error("Failed to PUT customer metadata", {
      lagoCustomerExternalId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function metadataArraysEqual(
  a: CustomerMetadataInput[],
  b: CustomerMetadataInput[],
): boolean {
  if (a.length !== b.length) return false;
  const toKey = (m: CustomerMetadataInput) =>
    `${m.key}|${m.value}|${m.display_in_invoice ? 1 : 0}`;
  const aKeys = a.map(toKey).sort();
  const bKeys = b.map(toKey).sort();
  return aKeys.every((k, i) => k === bKeys[i]);
}
