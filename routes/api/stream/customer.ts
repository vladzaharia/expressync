/**
 * GET /api/stream/customer — customer-gated SSE multiplex.
 *
 * Streams `transaction.meter`, `charger.state`, `notification.created`
 * events filtered to the caller's owned tags / sessions.
 *
 * The route classifier flags `/api/stream/customer` as `CUSTOMER_ONLY`
 * (see `src/lib/route-classifier.ts`); middleware handles authentication
 * and surface gating. We re-check `ctx.state.user` here as
 * defense-in-depth — if the middleware ever stops gating this prefix the
 * handler still rejects.
 *
 * Filter logic:
 *   - `transaction.meter`     → require `payload.userMappingId` ∈
 *                               `scope.mappingIds` (when present), or
 *                               `payload.transactionId` matches a known
 *                               steve transaction id owned by the caller.
 *                               Fall back to "no info → drop" so foreign
 *                               sessions never leak.
 *   - `charger.state`         → currently broadcast (charger occupancy
 *                               may matter for "free chargers near you").
 *                               No per-customer filter applied.
 *   - `notification.created`  → require `payload.adminUserId` equals
 *                               the caller's id (the schema column is
 *                               misleadingly named — see schema docstring)
 *                               OR `payload.adminUserId === null` (broadcast).
 *
 * Heartbeat / replay / idle behavior inherited from `openSseStream`.
 */

import { define } from "../../../utils.ts";
import {
  openSseStream,
  parseLastEventId,
  sseDisabledResponse,
} from "../../../src/lib/sse.ts";
import { resolveCustomerScope } from "../../../src/lib/scoping.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const scope = await resolveCustomerScope(ctx);
    const userId = ctx.state.actingAs ?? ctx.state.user.id;
    const ownedMappingIds = new Set(scope.mappingIds);

    const stream = openSseStream({
      label: `customer:${userId}`,
      types: [
        "transaction.meter",
        "charger.state",
        "notification.created",
      ],
      lastEventId: parseLastEventId(ctx.req),
      signal: ctx.req.signal,
      filter: (ev) => {
        if (ev.type === "notification.created") {
          const p = ev.payload as
            | { adminUserId?: string | null }
            | null;
          if (!p) return false;
          // Broadcast (`adminUserId == null`) OR targeted at this user.
          return p.adminUserId === null || p.adminUserId === userId;
        }
        if (ev.type === "transaction.meter") {
          // Filter at the mapping-id boundary when the publisher provides it.
          // If absent we drop — fail-closed avoids leaking other customers'
          // meter ticks. Publishers are expected to include `userMappingId`
          // in the payload for customer scoping.
          const p = ev.payload as { userMappingId?: number | null } | null;
          const mid = p?.userMappingId ?? null;
          if (mid === null || mid === undefined) return false;
          return ownedMappingIds.has(mid);
        }
        if (ev.type === "charger.state") {
          // Broadcast for now — operators may want to surface "EVSE-1 is
          // available" to all customers. Tightening to per-customer chargers
          // is a future enhancement (requires charger-↔-customer mapping).
          return true;
        }
        return false;
      },
    });

    if (!stream) {
      return sseDisabledResponse("SSE connection cap reached");
    }
    return stream;
  },
});
