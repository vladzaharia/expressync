/**
 * GET /api/admin/qr — server-rendered QR code for the public-ID
 * popover. Encodes whatever the caller passes in (the popover only
 * ever passes the public sticker URL — `https://example.com/c/<id>`
 * or `/u/<id>`), so the rendered code is byte-identical to what the
 * sticker would carry when printed.
 *
 * Returns `image/svg+xml`. Admin-only via the surface-vs-role guard
 * in `routes/_middleware.ts` (every /api/admin/* path requires
 * role=admin).
 */

import QRCode from "qrcode";
import { define } from "../../../utils.ts";

const MAX_LENGTH = 512;
const MIN_SIZE = 32;
const MAX_SIZE = 1024;

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response("Not Found", { status: 404 });
    }

    const url = new URL(ctx.req.url);
    const value = url.searchParams.get("value");
    if (!value) {
      return jsonError(400, "missing_value");
    }
    if (value.length > MAX_LENGTH) {
      return jsonError(400, "value_too_long");
    }

    const sizeRaw = Number(url.searchParams.get("size") ?? "256");
    const size = Number.isFinite(sizeRaw)
      ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(sizeRaw)))
      : 256;

    const svg = await QRCode.toString(value, {
      type: "svg",
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        // CurrentColor would be nicer but `qrcode`'s SVG output
        // doesn't support it; fall back to plain black/white. The
        // popover renders on a white card so contrast is fine.
        dark: "#000000",
        light: "#ffffff",
      },
    });

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Admin-only resource; allow short private caching so
        // re-rendering the popover is instant without exposing the
        // SVG to shared CDNs.
        "Cache-Control": "private, max-age=300",
      },
    });
  },
});

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
