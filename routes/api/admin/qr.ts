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

// Polaris theme palette (matches Tailwind's blue-500 / emerald-500
// roughly — the popover sits on a `bg-card`-class surface and these
// hues read well in both light and dark modes).
const BLUE = "#2563eb";
const GREEN = "#10b981";
const FINDER_BLUE = "#1d4ed8"; // a half-shade darker for the three finder squares

/** Deterministic 0..1 pseudo-random keyed on `(x,y,seed)`. */
function rand01(x: number, y: number, seed: number): number {
  let h = (x * 0x1f1f1f1f) ^ (y * 0x5f5e100) ^ seed;
  h = (h ^ (h >>> 16)) * 0x7feb352d;
  h = (h ^ (h >>> 15)) * 0x846ca68b;
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 0xffffffff);
}

/**
 * "Lightning bolt" mask in module space. Returns true when `(x,y)` is
 * inside the canonical bolt silhouette drawn over the centre 9x14
 * region of the QR. The bolt is a two-stroke Z: top-right slash, then
 * bottom-left slash, classic "energy" glyph.
 */
function isInBolt(x: number, y: number, size: number): boolean {
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;
  // Bounding box: roughly +/- 4 modules wide, +/- 7 modules tall.
  if (Math.abs(dx) > 4 || Math.abs(dy) > 7) return false;
  // Two strokes, each ~1.5 modules thick:
  //   stroke A: top-half, slope -2 (y = 2x + cy_top)
  //   stroke B: bottom-half, slope -2 mirrored
  if (dy <= 0) {
    return Math.abs(dy - 2 * dx + 3) < 2.5 && dx > -3 && dx < 3;
  } else {
    return Math.abs(dy - 2 * dx - 3) < 2.5 && dx > -3 && dx < 3;
  }
}

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

    // Raw bitmap so we can colourise per-module instead of returning
    // the encoder's default-black SVG.
    //
    // The `raw` output is a `Bitmap` instance (square boolean grid);
    // we treat it as a 2D number array via `data[y][x]` access (0/1)
    // to keep the rendering loop bog-standard.
    // deno-lint-ignore no-explicit-any
    const raw = encodeQR(value, "raw", { ecc: "medium" }) as any;
    const matrix: number[][] = Array.isArray(raw)
      ? raw as number[][]
      : (raw?.data as number[][]) ?? [];
    const size = matrix.length;
    if (size === 0) {
      // Fall back to the encoder's default svg if the raw shape isn't
      // what we expect (forward-compat with future package versions).
      const svg = encodeQR(value, "svg", {
        ecc: "medium",
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
    const seed = hashSeed(value);

    // Finder-square corners: each is 7x7 in standard QR (top-left,
    // top-right, bottom-left). Treat any module inside one of those
    // 7x7 zones as part of the finder for the darker blue accent so
    // the eye still parses the structure even when the data modules
    // are randomly tinted.
    const isFinder = (x: number, y: number) => {
      const inTL = x < 7 && y < 7;
      const inTR = x >= size - 7 && y < 7;
      const inBL = x < 7 && y >= size - 7;
      return inTL || inTR || inBL;
    };

    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dim * scale}" ` +
        `height="${dim * scale}" viewBox="0 0 ${dim} ${dim}" ` +
        `shape-rendering="crispEdges">`,
    );
    // No background rect — we want the popover's card background to
    // show through. Modules are filled directly.

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (matrix[y][x] !== 1) continue;
        const bolt = isInBolt(x, y, size);
        const finder = isFinder(x, y);
        const fill = finder
          ? FINDER_BLUE
          : bolt
          ? GREEN
          // Random green/blue elsewhere — ~20% green so the bolt still
          // reads as the focal accent.
          : (rand01(x, y, seed) < 0.2 ? GREEN : BLUE);
        parts.push(
          `<rect x="${x + border}" y="${y + border}" width="1" height="1" ` +
            `fill="${fill}"/>`,
        );
      }
    }
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

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) | (h << 4) | (h << 7) | (h << 8) | (h << 24))) >>> 0;
  }
  return h | 0;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
