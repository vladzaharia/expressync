/**
 * ExpresScan / Wave 3 Track C-result — tag enrichment for scan-result.
 *
 * Single function `enrichByIdTag(idTag)` that performs the
 * `user_mappings` ⨝ `lago_customers` ⨝ `lago_subscriptions` join used by
 * BOTH `POST /api/devices/scan-result` and the polling-fallback
 * `GET /api/devices/scan-result/{pairingCode}`. Source-of-truth for the
 * minimum-PII shape spelled out in `60-security.md` §10:
 *
 *   - `customer.displayName` — first non-null of: customerName, slug, externalId
 *   - `customer.slug`
 *   - `subscription.planLabel` — first non-null of: subscriptionName, planCode
 *   - `subscription.status`
 *   - `subscription.currentPeriodEndIso`
 *   - `subscription.billingTier`
 *
 * Anything else the join produces is intentionally dropped. The iPhone
 * success screen never displays it; carrying it on the wire is a PII
 * leak waiting to happen.
 *
 * Lookup strategy — uses the LOCAL Lago caches (`lago_customers`,
 * `lago_subscriptions`), never live `lagoClient` calls. The cache is the
 * source of truth for cross-cutting reads in this service: scan-result is a
 * latency-sensitive path (iPhone is waiting for the success screen), and a
 * Lago outage MUST NOT break it.
 *
 * "Found" semantics:
 *   - `tag` is non-null when a `user_mappings` row matches `idTag`. Even an
 *     orphaned mapping (no userId, no Lago link) returns the tag block.
 *   - `customer` and `subscription` are non-null only when the mapping has
 *     the corresponding Lago link AND a cached row exists. A cache miss
 *     for a known mapping renders as `customer: null` / `subscription: null`
 *     (caller decides whether that's "found" or not — the wire shape is the
 *     same).
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  lagoCustomers,
  lagoSubscriptions,
  userMappings,
} from "../db/schema.ts";
import type { EnrichedScanResult } from "../lib/types/devices.ts";
import { logger } from "../lib/utils/logger.ts";

const log = logger.child("DeviceEnrichment");

/** Strict subset of `EnrichedScanResult` returned by the service. */
export interface EnrichmentResult {
  found: boolean;
  tag: EnrichedScanResult["tag"];
  customer: EnrichedScanResult["customer"];
  subscription: EnrichedScanResult["subscription"];
}

/** Empty / not-found result. Wire shape: all three blocks null, found=false. */
const NOT_FOUND: EnrichmentResult = {
  found: false,
  tag: null,
  customer: null,
  subscription: null,
};

/**
 * Coerce the cached subscription `status` text column to the union the
 * `EnrichedScanResult` contract advertises. Anything outside the four
 * known values is dropped (defense-in-depth: we never echo unexpected
 * values to the client).
 */
function normalizeStatus(
  raw: string | null | undefined,
): EnrichedScanResult["subscription"] extends infer S
  ? S extends { status: infer T } ? T : never
  : never {
  if (
    raw === "active" || raw === "pending" || raw === "terminated" ||
    raw === "canceled"
  ) {
    return raw;
  }
  return null as never;
}

/**
 * Pull `current_billing_period_ending_at` out of the cached subscription
 * payload. The Lago response stores it in `payload.current_billing_period_ending_at`
 * (ISO-8601 string). Returns null on any extraction failure — cache writers
 * are tolerant of missing fields, so we do too.
 */
function extractCurrentPeriodEnd(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as { current_billing_period_ending_at?: unknown })
    .current_billing_period_ending_at;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Pull the human-readable subscription name from the payload. Falls back
 * to `plan_code` (already exposed as a column, but we re-read from payload
 * for parity with the admin tag detail page resolution order).
 */
function extractSubscriptionName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as { name?: unknown }).name;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Pull customer slug from the cached payload (the `lago_customers` row
 * doesn't denormalize slug as a column). Falls back to null.
 */
function extractCustomerSlug(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as { slug?: unknown }).slug;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Look up enrichment data for an `idTag` (already normalized to hex
 * uppercase). Single function reused by the POST and the polling fallback.
 *
 * Best-effort: any DB error is logged and converted to a NOT_FOUND result.
 * The caller decides whether to surface that as 200 with `found:false` or
 * something else — the contract is `200` regardless when the pairing was
 * legitimately consumed.
 */
export async function enrichByIdTag(
  idTag: string,
): Promise<EnrichmentResult> {
  if (!idTag || typeof idTag !== "string") {
    return { ...NOT_FOUND };
  }
  const normalized = idTag.toUpperCase();

  // 1. Mapping row by ocpp id-tag. We also need `is_active=true` to mirror
  //    the `scan-login.ts` lookup — an inactive mapping should not enrich
  //    (the customer hasn't actually got a working tag). NULL `userId` is
  //    fine: the tag block still renders, customer/subscription don't.
  let mapping:
    | {
      lagoCustomerExternalId: string | null;
      lagoSubscriptionExternalId: string | null;
      displayName: string | null;
      tagType: string;
      billingTier: string;
    }
    | undefined;
  try {
    const [m] = await db
      .select({
        lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
        lagoSubscriptionExternalId: userMappings.lagoSubscriptionExternalId,
        displayName: userMappings.displayName,
        tagType: userMappings.tagType,
        billingTier: userMappings.billingTier,
      })
      .from(userMappings)
      .where(
        and(
          eq(userMappings.steveOcppIdTag, normalized),
          eq(userMappings.isActive, true),
        ),
      )
      .limit(1);
    mapping = m;
  } catch (err) {
    log.warn("Mapping lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...NOT_FOUND };
  }

  if (!mapping) {
    return { ...NOT_FOUND };
  }

  // Tag block — populated even on orphaned mappings.
  const tag: EnrichedScanResult["tag"] = {
    displayName: mapping.displayName,
    tagType: mapping.tagType,
  };

  // 2. Customer + subscription lookups, in parallel from the cache.
  let customerRow:
    | {
      name: string | null;
      externalId: string;
      payload: unknown;
    }
    | undefined;
  let subscriptionRow:
    | {
      planCode: string | null;
      status: string | null;
      payload: unknown;
    }
    | undefined;

  if (mapping.lagoCustomerExternalId) {
    try {
      const [c] = await db
        .select({
          name: lagoCustomers.name,
          externalId: lagoCustomers.externalId,
          payload: lagoCustomers.payload,
        })
        .from(lagoCustomers)
        .where(
          and(
            eq(lagoCustomers.externalId, mapping.lagoCustomerExternalId),
            isNull(lagoCustomers.deletedAt),
          ),
        )
        .limit(1);
      customerRow = c;
    } catch (err) {
      log.warn("Customer cache lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (mapping.lagoSubscriptionExternalId) {
    try {
      const [s] = await db
        .select({
          planCode: lagoSubscriptions.planCode,
          status: lagoSubscriptions.status,
          payload: lagoSubscriptions.payload,
        })
        .from(lagoSubscriptions)
        .where(
          and(
            eq(
              lagoSubscriptions.externalId,
              mapping.lagoSubscriptionExternalId,
            ),
            isNull(lagoSubscriptions.deletedAt),
          ),
        )
        .limit(1);
      subscriptionRow = s;
    } catch (err) {
      log.warn("Subscription cache lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Customer block. `displayName` is the first non-null of
  //    customerName, slug, externalId — matches the admin detail page
  //    convention and gives the iPhone something legible regardless of
  //    Lago's data quality.
  let customer: EnrichedScanResult["customer"] = null;
  if (customerRow) {
    const slug = extractCustomerSlug(customerRow.payload);
    const displayName = customerRow.name ?? slug ?? customerRow.externalId ??
      null;
    customer = {
      displayName,
      slug,
    };
  } else if (mapping.lagoCustomerExternalId) {
    // Cache miss but mapping points at a customer — fall back to the
    // mapping's display name + the externalId as the displayName, so the
    // iPhone has at least a label. No slug.
    customer = {
      displayName: mapping.displayName ?? mapping.lagoCustomerExternalId,
      slug: null,
    };
  }

  // 4. Subscription block. `planLabel` is the first non-null of
  //    subscriptionName, planCode. `currentPeriodEndIso` is read out of
  //    the JSON payload (the cache table doesn't denormalize that field).
  //    `billingTier` comes from the user_mappings row — Lago doesn't track
  //    it natively, we layer that on top.
  let subscription: EnrichedScanResult["subscription"] = null;
  if (subscriptionRow) {
    const subName = extractSubscriptionName(subscriptionRow.payload);
    const planLabel = subName ?? subscriptionRow.planCode ?? null;
    const currentPeriodEndIso = extractCurrentPeriodEnd(
      subscriptionRow.payload,
    );
    const billingTier = mapping.billingTier === "comped"
      ? "comped"
      : mapping.billingTier === "standard"
      ? "standard"
      : null;
    subscription = {
      planLabel,
      status: normalizeStatus(subscriptionRow.status),
      currentPeriodEndIso,
      billingTier,
    };
  }

  return {
    // Found if we resolved at minimum a mapping row. Customer / subscription
    // null is a valid found-state (orphaned mapping, cache miss, etc.).
    found: true,
    tag,
    customer,
    subscription,
  };
}
