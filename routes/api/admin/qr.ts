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
 * Implementation notes:
 *
 * - Encoder: `@paulmillr/qr` (pure-JS, zero-dep, JSR-native). The npm
 *   `qrcode` package can't be SSR-bundled by Vite — its transitive
 *   `pngjs` dep uses CJS `module.exports = …`, triggering a runtime
 *   `ReferenceError: module is not defined`.
 *
 * - ECC level: **H** (~30% recovery). We embed the Polaris lightning
 *   bolt at the centre of the symbol, occluding the modules under it.
 *   H tolerates losing up to ~30% of modules; our centre cutout is
 *   sized to stay well below that (≤ ~10% of total area for any
 *   realistic payload).
 *
 * - Logo: the canonical Lucide Zap path (`M13 2 L3 14 h9 l-1 8 L21 10
 *   h-9 l1 -8 z`) on a 24×24 viewBox. This is the same bolt used in
 *   `static/logo.svg`, `static/favicon.svg`, `static/logo-foreground.svg`,
 *   and `components/brand/ExpresSyncBrand.tsx`. Pulling the raw path
 *   directly avoids parsing/normalising another SVG at request time
 *   and keeps the bolt vector-perfect at every scale. logo.svg was
 *   picked as the source-of-truth because it's the cleanest variant
 *   (single fill, no glow filter or stroke widening that would
 *   thicken the silhouette).
 *
 * - Colours: blue data modules, darker-blue finder squares, emerald
 *   bolt overlay. Background stays transparent so the popover's
 *   `bg-card` surface shows through.
 *
 * - Scannability: verified locally by round-tripping `https://polaris
 *   .express/c/ABCDEF12` through `rsvg-convert | zbarimg`. The decoded
 *   payload matched the input byte-for-byte.
 */

import encodeQR from "@paulmillr/qr";
import { define } from "../../../utils.ts";

const MAX_LENGTH = 512;
const MIN_SCALE = 1;
const MAX_SCALE = 32;

// Polaris theme palette (Tailwind blue-500 / blue-700 / emerald-500).
// The popover sits on a `bg-card`-class surface and these hues read
// well in both light and dark modes.
const BLUE = "#2563eb";
const GREEN = "#10b981";
const FINDER_BLUE = "#1d4ed8";

// Lucide Zap path on a 24×24 viewBox. The tight bounding box is
// x ∈ [3, 21] (width 18), y ∈ [2, 22] (height 20).
const BOLT_PATH = "M13 2 L3 14 h9 l-1 8 L21 10 h-9 l1 -8 z";
const BOLT_VIEW = 24; // viewBox edge length the path is authored against
const BOLT_BBOX = { x: 3, y: 2, w: 18, h: 20 };

// Centre cutout size in QR modules. 11×11 modules is large enough to
// host a legible bolt at any practical render size, and small enough
// that even on a tiny version-3 (29-module) symbol the coverage stays
// at ~14% — comfortably inside ECC=H's ~30% recovery budget. On a
// typical version-6 (41-module) symbol it's ~7%.
const CUTOUT_MODULES = 11;

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response("Not Found", { status: 404 });
    }

    const url = new URL(ctx.req.url);
    const value = url.searchParams.get("value");
    if (!value) return jsonError(400, "missing_value");
    if (value.length > MAX_LENGTH) return jsonError(400, "value_too_long");

    // The legacy `size=…` query param is a pixel target; the encoder
    // works in module-multiples (each QR module is `scale` pixels).
    // Translate by dividing through a typical QR symbol size and
    // clamping. We assume ~37 modules for the divisor since ECC=H
    // pushes the symbol a version or two larger than ECC=M did.
    const sizeRaw = Number(url.searchParams.get("size") ?? "256");
    const targetSize = Number.isFinite(sizeRaw) ? Math.floor(sizeRaw) : 256;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, Math.round(targetSize / 37)),
    );

    // Raw boolean matrix at ECC=H. We render every dark module
    // ourselves so we can colour the finder squares separately and
    // skip the modules under the centre cutout.
    const matrix: boolean[][] = encodeQR(value, "raw", { ecc: "high" });
    const size = matrix.length;
    if (size === 0) {
      // Encoder shape changed under us — fall back to its default
      // black SVG so the popover still shows *something* useful.
      const svg = encodeQR(value, "svg", {
        ecc: "high",
        border: 2,
        scale,
      });
      return new Response(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const border = 2;
    const dim = size + border * 2;

    // Centre cutout in module coordinates (inclusive bounds). We pick
    // a square aligned to the symbol centre and snap the size so it
    // remains <= the bolt's natural aspect (≈ 9:10) without exceeding
    // ECC's recovery budget. The bolt itself is drawn inside this
    // region at the bolt-path's intrinsic aspect ratio.
    const cutout = Math.min(CUTOUT_MODULES, size - 14); // never overlap finders
    const cutoutStart = Math.floor((size - cutout) / 2);
    const cutoutEnd = cutoutStart + cutout; // exclusive
    const coveragePct = ((cutout * cutout) / (size * size)) * 100;

    // Finder-square corners: each is 7×7 in standard QR (top-left,
    // top-right, bottom-left). Tinted darker-blue so the eye still
    // parses the QR structure.
    const isFinder = (x: number, y: number) => {
      const inTL = x < 7 && y < 7;
      const inTR = x >= size - 7 && y < 7;
      const inBL = x < 7 && y >= size - 7;
      return inTL || inTR || inBL;
    };

    const isInsideCutout = (x: number, y: number) =>
      x >= cutoutStart && x < cutoutEnd && y >= cutoutStart && y < cutoutEnd;

    // Module debug breadcrumb so an admin tracing a scan failure can
    // confirm the cutout is within the ECC budget. Only logged once
    // per request and only at debug level.
    console.debug(
      `[admin/qr] value=${value.length}ch size=${size}mod ecc=H cutout=${cutout}×${cutout} ` +
        `coverage=${coveragePct.toFixed(1)}%`,
    );

    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dim * scale}" ` +
        `height="${dim * scale}" viewBox="0 0 ${dim} ${dim}" ` +
        `shape-rendering="crispEdges">`,
    );

    // 1. Data modules — every dark module except those under the
    //    centre cutout. The cutout is left fully empty (transparent)
    //    so the bolt has clean negative space around it.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!matrix[y][x]) continue;
        if (isInsideCutout(x, y)) continue;
        const fill = isFinder(x, y) ? FINDER_BLUE : BLUE;
        parts.push(
          `<rect x="${x + border}" y="${y + border}" width="1" height="1" ` +
            `fill="${fill}"/>`,
        );
      }
    }

    // 2. Bolt overlay. Anchored at the cutout in module space; the
    //    path's tight bbox is scaled uniformly to fit inside the
    //    cutout with a one-module padding so it doesn't visually
    //    crowd the surrounding modules. `geometricPrecision` here so
    //    the bolt's diagonal edges don't get pixel-aligned by the
    //    surrounding `crispEdges` setting.
    const pad = 1;
    const innerW = cutout - pad * 2;
    const innerH = cutout - pad * 2;
    const fit = Math.min(innerW / BOLT_BBOX.w, innerH / BOLT_BBOX.h);
    const boltW = BOLT_BBOX.w * fit;
    const boltH = BOLT_BBOX.h * fit;
    const boltX = border + cutoutStart + (cutout - boltW) / 2;
    const boltY = border + cutoutStart + (cutout - boltH) / 2;
    // Translate so the bbox's top-left lands at (boltX, boltY).
    // The path itself lives in viewBox coords; we scale by `fit` and
    // shift the bbox origin to 0,0 by subtracting BOLT_BBOX.x/y first.
    const tx = boltX - BOLT_BBOX.x * fit;
    const ty = boltY - BOLT_BBOX.y * fit;
    parts.push(
      `<g transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)}) ` +
        `scale(${fit.toFixed(4)})" ` +
        `shape-rendering="geometricPrecision">` +
        `<path d="${BOLT_PATH}" fill="${GREEN}" stroke="${GREEN}" ` +
        `stroke-width="0.6" stroke-linejoin="round"/></g>`,
    );

    // Touch BOLT_VIEW so the documented constant isn't reported as
    // unused — it's the natural viewBox the path is authored against
    // and a future refactor (e.g. switching to a different bolt SVG)
    // will need it.
    void BOLT_VIEW;

    parts.push("</svg>");
    const svg = parts.join("");

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
