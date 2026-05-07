/**
 * POST /api/admin/charger/{chargeBoxId}/deactivate — soft-delete an
 * unmanaged charger. Sets `deactivated_at = now()` so the row drops
 * out of `tappable_devices` (the view filters on null) and the
 * public landing renders a "retired" copy.
 *
 * Managed (OCPP) chargers are out of scope here — they're managed by
 * StEvE sync, so admin-side deletion would race the next reconcile
 * pass. Reactivation: clear `deactivated_at` directly via the PATCH
 * endpoint (left as an admin escape hatch; no UI yet).
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { chargersCache } from "../../../../../src/db/schema.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger;

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(404, { error: "not_found" });
    }

    const chargeBoxId = ctx.params.chargeBoxId;
    if (!chargeBoxId) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }

    let row: typeof chargersCache.$inferSelect | undefined;
    try {
      [row] = await db
        .select()
        .from(chargersCache)
        .where(eq(chargersCache.chargeBoxId, chargeBoxId))
        .limit(1);
    } catch (err) {
      log.error("ChargerDeactivate", "fetch failed", err as Error);
      return jsonResponse(500, { error: "internal" });
    }

    if (!row) return jsonResponse(404, { error: "not_found" });
    if (row.managementMode !== "unmanaged") {
      return jsonResponse(400, {
        error: "Only unmanaged chargers can be deactivated",
      });
    }
    if (row.deactivatedAt) {
      // Idempotent — return 200 with the existing timestamp.
      return jsonResponse(200, {
        deactivatedAt: row.deactivatedAt.toISOString(),
      });
    }

    try {
      const [updated] = await db
        .update(chargersCache)
        .set({ deactivatedAt: new Date() })
        .where(eq(chargersCache.chargeBoxId, chargeBoxId))
        .returning({ deactivatedAt: chargersCache.deactivatedAt });
      return jsonResponse(200, {
        deactivatedAt: updated.deactivatedAt?.toISOString() ?? null,
      });
    } catch (err) {
      log.error("ChargerDeactivate", "update failed", err as Error);
      return jsonResponse(500, { error: "internal" });
    }
  },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
