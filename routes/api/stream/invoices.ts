/**
 * GET /api/stream/invoices?invoiceId=... — admin-gated single-invoice SSE.
 *
 * Emits `invoice.updated` events filtered to the supplied `invoiceId`. Split
 * out of `/api/stream/chargers` so the InvoiceDetail island can subscribe to
 * exactly the invoice it's viewing instead of receiving cross-scope events.
 *
 * Supports `Last-Event-ID` replay within the event-bus' 60-second ring buffer.
 * Heartbeat every 15s via `openSseStream`.
 */

import { define } from "../../../utils.ts";
import { config } from "../../../src/lib/config.ts";
import {
  openSseStream,
  parseLastEventId,
  sseDisabledResponse,
} from "../../../src/lib/sse.ts";

export const handler = define.handlers({
  GET(ctx) {
    // Defense-in-depth admin gate (mirrors chargers + notifications streams).
    if (ctx.state.user?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(ctx.req.url);
    const invoiceId = url.searchParams.get("invoiceId");
    if (!invoiceId) {
      return new Response(
        JSON.stringify({ error: "Missing required query param: invoiceId" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (!config.ENABLE_SSE) {
      return sseDisabledResponse("SSE disabled (ENABLE_SSE=false)");
    }

    const stream = openSseStream({
      label: `invoices:${invoiceId}`,
      types: ["invoice.updated"],
      lastEventId: parseLastEventId(ctx.req),
      signal: ctx.req.signal,
      filter: (ev) => {
        const pid = (ev.payload as { invoiceId?: string } | null)?.invoiceId;
        return pid === invoiceId;
      },
    });

    if (!stream) {
      return sseDisabledResponse("SSE connection cap reached");
    }
    return stream;
  },
});
