import { define } from "../../../../../utils.ts";
import { steveClient } from "../../../../../src/lib/steve-client.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

/**
 * GET /api/charger/{chargeBoxId}/recent-tag
 *
 * Admin-only (guarded by `ADMIN_ONLY_PATHS` in routes/_middleware.ts, which
 * covers `/api/charger`). Returns the most recently used OCPP idTag on this
 * charger so the picker UI can default to a sensible "last used" tag.
 *
 * Implementation note: our local `synced_transaction_events` table has no
 * `chargeBoxId` column and is not joined to one via `transaction_sync_state`
 * either — the chargeBox is only known to StEvE. So we ask StEvE for
 * transactions on this chargeBoxId (type=ALL so active sessions count too)
 * and pick the one with the most recent `startTimestamp`.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const chargeBoxId = ctx.params.chargeBoxId;

    if (typeof chargeBoxId !== "string" || chargeBoxId.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "chargeBoxId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const transactions = await steveClient.getTransactions({
        chargeBoxId,
        type: "ALL",
        periodType: "ALL",
      });

      if (transactions.length === 0) {
        return new Response(
          JSON.stringify({ idTag: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Pick the transaction with the latest startTimestamp. StEvE orders
      // are not guaranteed stable across versions, so sort defensively.
      let latest = transactions[0];
      for (const tx of transactions) {
        if (tx.startTimestamp > latest.startTimestamp) {
          latest = tx;
        }
      }

      return new Response(
        JSON.stringify({ idTag: latest.ocppIdTag ?? null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error(
        "ChargerAPI",
        "Failed to fetch recent tag for charger",
        error as Error,
      );
      return new Response(
        JSON.stringify({ error: "Failed to fetch recent tag" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
