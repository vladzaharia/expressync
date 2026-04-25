import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { lagoClient } from "../../../../src/lib/lago-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/usage
 *
 * Returns current billing usage for each active mapping that has both
 * a customer and a subscription configured. Output is keyed by
 * (customerId, subscriptionId) — multiple tags pointing at the same
 * subscription are deduplicated.
 *
 * Performance: the underlying Lago `getCurrentUsage` call lands at
 * ~50–200 ms per (customer, subscription) pair, so a fleet with 200
 * active subscriptions would block this endpoint for 10–40 s without
 * caching. We hold each result for 5 minutes in-process and bound
 * each call to 3 s — slow Lago calls return `{ stale: true }` rather
 * than stalling the whole page load.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const PER_CALL_TIMEOUT_MS = 3_000;
const CACHE_CAP = 1024;

interface UsageCacheEntry {
  storedAt: number;
  // Allow either a successful response or a captured error so the
  // cache survives transient Lago hiccups without re-attempting them
  // on every page load.
  value: unknown;
  ok: boolean;
}

const usageCache = new Map<string, UsageCacheEntry>();

function rememberUsage(key: string, value: unknown, ok: boolean) {
  if (usageCache.size >= CACHE_CAP) {
    const oldest = usageCache.keys().next().value;
    if (oldest !== undefined) usageCache.delete(oldest);
  }
  usageCache.set(key, { storedAt: Date.now(), value, ok });
}

function readUsage(
  key: string,
): { entry: UsageCacheEntry; fresh: boolean } | null {
  const entry = usageCache.get(key);
  if (!entry) return null;
  return { entry, fresh: Date.now() - entry.storedAt < CACHE_TTL_MS };
}

/** Race a promise against a timeout; resolves with `{ timedOut: true }` on miss. */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ value: T; timedOut: false } | { timedOut: true }> {
  let to: number | undefined;
  const timer = new Promise<{ timedOut: true }>((resolve) => {
    to = setTimeout(() => resolve({ timedOut: true }), ms) as unknown as number;
  });
  try {
    const result = await Promise.race([
      p.then((value) => ({ value, timedOut: false as const })),
      timer,
    ]);
    return result;
  } finally {
    if (to !== undefined) clearTimeout(to);
  }
}

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      // Fetch active mappings with both customer and subscription set
      const mappings = await db
        .select()
        .from(schema.userMappings)
        .where(
          and(
            eq(schema.userMappings.isActive, true),
            isNotNull(schema.userMappings.lagoCustomerExternalId),
            isNotNull(schema.userMappings.lagoSubscriptionExternalId),
          ),
        );

      // Deduplicate by customer+subscription pair (multiple tags can share one)
      const seen = new Set<string>();
      const uniquePairs: Array<{
        customerId: string;
        subscriptionId: string;
        displayName: string | null;
      }> = [];

      for (const mapping of mappings) {
        const key =
          `${mapping.lagoCustomerExternalId}:${mapping.lagoSubscriptionExternalId}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniquePairs.push({
            customerId: mapping.lagoCustomerExternalId!,
            subscriptionId: mapping.lagoSubscriptionExternalId!,
            displayName: mapping.displayName,
          });
        }
      }

      // Fetch current usage for each unique pair, with cache + timeout
      const usageResults = await Promise.allSettled(
        uniquePairs.map(async (pair) => {
          const cacheKey = `${pair.customerId}:${pair.subscriptionId}`;
          const cached = readUsage(cacheKey);
          if (cached && cached.fresh) {
            return {
              customerId: pair.customerId,
              subscriptionId: pair.subscriptionId,
              displayName: pair.displayName,
              usage: cached.entry.ok ? cached.entry.value : undefined,
              error: cached.entry.ok
                ? undefined
                : (cached.entry.value as { message?: string })?.message ??
                  "cached error",
              cached: true,
            };
          }

          const result = await withTimeout(
            lagoClient.getCurrentUsage(pair.customerId, pair.subscriptionId),
            PER_CALL_TIMEOUT_MS,
          );
          if (result.timedOut) {
            // Serve a stale value if any so the page still loads. Otherwise
            // degrade to a "stale: true" placeholder.
            if (cached) {
              return {
                customerId: pair.customerId,
                subscriptionId: pair.subscriptionId,
                displayName: pair.displayName,
                usage: cached.entry.ok ? cached.entry.value : undefined,
                error: cached.entry.ok ? undefined : "stale (timeout)",
                cached: true,
                stale: true,
              };
            }
            return {
              customerId: pair.customerId,
              subscriptionId: pair.subscriptionId,
              displayName: pair.displayName,
              error:
                `Lago getCurrentUsage timed out after ${PER_CALL_TIMEOUT_MS}ms`,
              stale: true,
            };
          }
          rememberUsage(cacheKey, result.value, true);
          return {
            customerId: pair.customerId,
            subscriptionId: pair.subscriptionId,
            displayName: pair.displayName,
            usage: result.value,
            cached: false,
          };
        }),
      );

      const usage = usageResults.map((result, i) => {
        if (result.status === "fulfilled") {
          return result.value;
        }
        const err = result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason));
        // Cache the failure so we don't re-hammer Lago every page load.
        rememberUsage(
          `${uniquePairs[i].customerId}:${uniquePairs[i].subscriptionId}`,
          { message: err.message },
          false,
        );
        return {
          customerId: uniquePairs[i].customerId,
          subscriptionId: uniquePairs[i].subscriptionId,
          displayName: uniquePairs[i].displayName,
          error: err.message,
        };
      });

      return new Response(
        JSON.stringify({ usage }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch usage data", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch usage data" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});

/** Test-only: clear cache between assertions. */
export const _internal = { usageCache };
