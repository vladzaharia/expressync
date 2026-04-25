import { define } from "../../../../utils.ts";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/charger?limit=&skip=
 *
 * Returns charge boxes from StEvE with pagination applied post-fetch.
 * StEvE returns the full list in one shot, so the slicing is in JS.
 *
 * Response keeps the legacy `chargeBoxes` array for back-compat with
 * existing callers and adds `{ rows, total, limit, skip }` per the
 * established admin pagination shape (see
 * `routes/api/admin/transaction/index.ts`).
 */
export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const hasPaginationParams = url.searchParams.has("limit") ||
        url.searchParams.has("skip");
      const skipRaw = parseInt(url.searchParams.get("skip") || "0", 10);
      const skip = isNaN(skipRaw) || skipRaw < 0 ? 0 : skipRaw;
      const limitRaw = parseInt(url.searchParams.get("limit") || "25", 10);
      const limit = isNaN(limitRaw) ? 25 : Math.max(1, Math.min(100, limitRaw));

      const all = await steveClient.getChargeBoxes();
      const total = all.length;
      const page = hasPaginationParams ? all.slice(skip, skip + limit) : all;

      return new Response(
        // `chargeBoxes` retained for callers that pre-date the pagination
        // contract; new callers should read `rows`. When no pagination
        // params are passed we keep the full list under both keys so the
        // response is compatible with the legacy unpaginated shape.
        JSON.stringify({
          chargeBoxes: page,
          rows: page,
          total,
          limit,
          skip,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch charge boxes", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch charge boxes" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
