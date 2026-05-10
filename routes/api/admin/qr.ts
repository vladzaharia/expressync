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
 *
 * Implementation note: uses `@paulmillr/qr` — pure-JS, zero-dep,
 * JSR-native. Replaced the npm `qrcode` package, which Vite's SSR
 * bundler couldn't handle (its transitive `pngjs` dep uses CJS
 * `module.exports = …`, producing a `ReferenceError: module is not
 * defined` at runtime).
 */

import encodeQR from "@paulmillr/qr";
import { define } from "../../../utils.ts";

const MAX_LENGTH = 512;
const MIN_SCALE = 1;
const MAX_SCALE = 32;

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response("Not Found", { status: 404 });
    }

    const url = new URL(ctx.req.url);
    const value = url.searchParams.get("value");
    if (!value) return jsonError(400, "missing_value");
    if (value.length > MAX_LENGTH) return jsonError(400, "value_too_long");

    // The legacy `size=…` query param was a pixel target; the new
    // encoder works in module-multiples (each QR module is `scale`
    // pixels). Translate by dividing through a typical QR symbol
    // size (~33 modules) and clamping.
    const sizeRaw = Number(url.searchParams.get("size") ?? "256");
    const targetSize = Number.isFinite(sizeRaw) ? Math.floor(sizeRaw) : 256;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, Math.round(targetSize / 33)),
    );

    const svg = encodeQR(value, "svg", {
      ecc: "medium",
      border: 2,
      scale,
    });

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Admin-only resource; allow short private caching so the
        // popover re-renders instantly without exposing the SVG to
        // shared CDNs.
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
