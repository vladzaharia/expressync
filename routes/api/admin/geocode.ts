/**
 * POST /api/admin/geocode — server-side proxy to Nominatim
 * (OpenStreetMap). Used by the inline charger location editor for
 * forward (free-text → lat/lon + address) and reverse (lat/lon →
 * address) geocoding.
 *
 * Server-proxied so we can attach the required Nominatim User-Agent
 * (with contact email) and enforce the 1 rps usage cap process-side
 * — neither is achievable from the browser.
 *
 * Admin-only via the surface-vs-role guard in
 * `routes/_middleware.ts`.
 */

import { z } from "zod";
import { define } from "../../../utils.ts";
import {
  geocodeForward,
  geocodeReverse,
} from "../../../src/lib/utils/nominatim.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger;

const RequestSchema = z.union([
  z.object({ q: z.string().min(1).max(300) }),
  z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
]);

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(404, { error: "not_found" });
    }

    let body: z.infer<typeof RequestSchema>;
    try {
      body = RequestSchema.parse(await ctx.req.json());
    } catch {
      return jsonResponse(400, { error: "invalid_body" });
    }

    try {
      const result = "q" in body
        ? await geocodeForward(body.q)
        : await geocodeReverse(body.lat, body.lon);
      if (!result) {
        return jsonResponse(404, { error: "not_found" });
      }
      return jsonResponse(200, result);
    } catch (err) {
      log.error("API", "geocode failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(502, { error: "geocode_unavailable" });
    }
  },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
