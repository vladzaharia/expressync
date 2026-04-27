/**
 * GET /api/admin/charger/labels
 *
 * Returns `{ [chargeBoxId]: friendlyName }` for every row in
 * `chargers_cache` whose `friendly_name` is non-null. Used by client
 * islands that surface charger references arriving over SSE (e.g.
 * `LiveSessionsList`, `UnlockConnectorDialog`) and only know the
 * `chargeBoxId` — the lookup lets them render the human label
 * without each emitter having to embed it in the payload.
 *
 * Cookie-gated, admin-only via the middleware route classifier.
 * Cheap query: indexed scan, label column only.
 */

import { isNotNull } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { chargersCache } from "../../../../src/db/schema.ts";

export const handler = define.handlers({
  async GET() {
    const rows = await db
      .select({
        chargeBoxId: chargersCache.chargeBoxId,
        friendlyName: chargersCache.friendlyName,
      })
      .from(chargersCache)
      .where(isNotNull(chargersCache.friendlyName));

    const labels: Record<string, string> = {};
    for (const r of rows) {
      if (r.friendlyName) labels[r.chargeBoxId] = r.friendlyName;
    }

    return new Response(JSON.stringify({ labels }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=30",
      },
    });
  },
});
