import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { lagoClient } from "../../../../src/lib/lago-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/usage
 *
 * Returns current billing usage for each active mapping that has
 * both a customer and subscription configured.
 *
 * Calls lagoClient.getCurrentUsage() for each qualifying mapping.
 */
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

      // Fetch current usage for each unique pair
      const usageResults = await Promise.allSettled(
        uniquePairs.map(async (pair) => {
          const usage = await lagoClient.getCurrentUsage(
            pair.customerId,
            pair.subscriptionId,
          );
          return {
            customerId: pair.customerId,
            subscriptionId: pair.subscriptionId,
            displayName: pair.displayName,
            usage,
          };
        }),
      );

      const usage = usageResults.map((result, i) => {
        if (result.status === "fulfilled") {
          return result.value;
        }
        return {
          customerId: uniquePairs[i].customerId,
          subscriptionId: uniquePairs[i].subscriptionId,
          displayName: uniquePairs[i].displayName,
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
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
