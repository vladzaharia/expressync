/**
 * GET /api/auth/scan-charger-list
 *
 * Polaris Track C — public endpoint that lists chargers from the
 * `chargers_cache` table so the customer login UI can populate a picker
 * (or auto-bind when N=1).
 *
 * Public route — no session required. Rate-limited per IP.
 *
 * Response:
 *   { chargers: [
 *       { chargeBoxId: "EVSE-1",
 *         friendlyName: "Garage" | null,
 *         status: "available" | "occupied" | "offline" | null,
 *         online: boolean }
 *       ...
 *     ]
 *   }
 *
 * "online" is derived from `last_seen_at`: a charger seen within the last
 * 60 minutes is considered online (matches the UI's "Offline" badge
 * threshold). The customer login modal filters to `online === true` for
 * its picker, but we expose all rows so the picker can render an
 * "All chargers offline" message rather than empty state.
 */

import { desc } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { chargersCache } from "../../../src/db/schema.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import {
  FEATURE_SCAN_LOGIN,
  featureDisabledResponse,
} from "../../../src/lib/feature-flags.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ScanChargerList");

const RATE_LIMIT_PER_IP = 30; // per minute
const ONLINE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes — match login-page gate

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function rateLimited(): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!FEATURE_SCAN_LOGIN) {
      return featureDisabledResponse("scan-login");
    }

    const ip = getClientIp(ctx.req);
    if (!await checkRateLimit(`scancharger:${ip}`, RATE_LIMIT_PER_IP)) {
      return rateLimited();
    }

    try {
      const rows = await db
        .select({
          chargeBoxId: chargersCache.chargeBoxId,
          friendlyName: chargersCache.friendlyName,
          status: chargersCache.lastStatus,
          lastSeenAt: chargersCache.lastSeenAt,
        })
        .from(chargersCache)
        .orderBy(desc(chargersCache.lastSeenAt));

      const now = Date.now();
      const chargers = rows.map((r) => {
        const lastSeen = r.lastSeenAt instanceof Date
          ? r.lastSeenAt.getTime()
          : new Date(r.lastSeenAt as unknown as string).getTime();
        const online = isFinite(lastSeen) &&
          (now - lastSeen) <= ONLINE_WINDOW_MS;
        return {
          chargeBoxId: r.chargeBoxId,
          friendlyName: r.friendlyName,
          status: r.status,
          online,
        };
      });

      return new Response(
        JSON.stringify({ chargers }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      log.error("Failed to list chargers from cache", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ chargers: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
