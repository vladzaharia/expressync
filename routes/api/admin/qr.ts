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
 * - ECC level: **H** (~30% recovery) — kept high even though we no
 *   longer occlude modules, as a buffer against any decoder that
 *   over-reacts to the dual-tone fill.
 *
 * - Bolt as **module recoloring** (not overlay). Every dark module
 *   stays put — finder squares, timing, alignment, data — so the QR
 *   is structurally identical to a plain monochrome render. The bolt
 *   silhouette only changes the *colour* of modules that fall inside
 *   its polygon: green inside, blue outside, with finder squares
 *   getting a darker-blue accent. Both colours threshold as "dark"
 *   against the popover's light card background, so luminance-based
 *   QR decoders (every commodity scanner) see a normal black-and-
 *   white symbol.
 *
 * - Bolt silhouette: a hand-tuned rounded version of the Lucide Zap
 *   path (`M13 2 L3 14 h9 l-1 8 L21 10 h-9 l1 -8 z`). Each of the
 *   six sharp corners is replaced with a quadratic-Bézier arc so the
 *   shape reads as a smooth lightning bolt instead of a 3-segment
 *   zigzag. The polygon spans ~70% of the symbol width / 88% of
 *   height (re-fit to the symbol bbox), making the bolt visibly
 *   dominant inside the QR.
 *
 * - Colours: blue data modules (Tailwind blue-500), darker-blue finder
 *   squares (blue-700), emerald bolt fill (emerald-500). Background
 *   stays transparent so the popover's `bg-card` surface shows
 *   through.
 *
 * - Scannability: every module is preserved (no cutout). Tested with
 *   `rsvg-convert | zbarimg` over a 256px render; payload round-trips
 *   byte-for-byte at ECC=H.
 */

import encodeQR from "@paulmillr/qr";
import { define } from "../../../utils.ts";

const MAX_LENGTH = 512;
const MIN_SCALE = 1;
const MAX_SCALE = 32;

// Polaris theme palette. The popover sits on a `bg-card`-class surface
// and these hues read well in both light and dark modes. Both fills
// are dark enough (luminance <0.4) to threshold below the card
// background, keeping the QR luminance-decodable.
const BLUE = "#2563eb";
const GREEN = "#10b981";
const FINDER_BLUE = "#1d4ed8";

// --------------------------------------------------------------------
// Rounded lightning-bolt polygon
// --------------------------------------------------------------------
//
// The six sharp Zap-path vertices in 24-unit space, normalised to
// 0..1. Polygon winding is the same as the SVG path:
//
//   A: top tip
//   B: top-left inner corner
//   C: mid-left split
//   D: bottom tip
//   E: bottom-right inner corner
//   F: mid-right split
//
// Corner-rounding is applied uniformly at all six vertices via a
// quadratic-Bézier arc (start = `radius` along the prev-edge,
// control = the sharp vertex, end = `radius` along the next-edge).

const SHARP_BOLT: Array<[number, number]> = [
  [13 / 24, 2 / 24], // A — top tip
  [3 / 24, 14 / 24], // B — top-left inner corner
  [12 / 24, 14 / 24], // C — mid-left split
  [11 / 24, 22 / 24], // D — bottom tip
  [21 / 24, 10 / 24], // E — bottom-right inner corner
  [12 / 24, 10 / 24], // F — mid-right split
];

const CORNER_RADIUS = 0.06; // in 0..1 space — gives a soft but recognisable round
const ARC_STEPS = 6; // per corner

function buildRoundedBolt(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = SHARP_BOLT.length;
  for (let i = 0; i < n; i++) {
    const prev = SHARP_BOLT[(i - 1 + n) % n];
    const v = SHARP_BOLT[i];
    const next = SHARP_BOLT[(i + 1) % n];
    out.push(...roundCorner(prev, v, next, CORNER_RADIUS, ARC_STEPS));
  }
  return out;
}

/**
 * Replace the sharp corner at `v` with a quadratic-Bézier arc.
 * `prev`→`v`→`next` are consecutive polygon vertices. The arc starts
 * `radius` along the `prev`→`v` edge, passes near `v` (which is the
 * Bézier control point), and ends `radius` along the `v`→`next` edge.
 */
function roundCorner(
  prev: [number, number],
  v: [number, number],
  next: [number, number],
  radius: number,
  steps: number,
): Array<[number, number]> {
  const dPrevX = v[0] - prev[0];
  const dPrevY = v[1] - prev[1];
  const lenPrev = Math.hypot(dPrevX, dPrevY) || 1;
  const dNextX = next[0] - v[0];
  const dNextY = next[1] - v[1];
  const lenNext = Math.hypot(dNextX, dNextY) || 1;

  // Clamp the radius so it never overshoots half the shorter incident
  // edge — otherwise adjacent arcs would cross each other.
  const r = Math.min(radius, lenPrev / 2.5, lenNext / 2.5);

  const start: [number, number] = [
    v[0] - (dPrevX / lenPrev) * r,
    v[1] - (dPrevY / lenPrev) * r,
  ];
  const end: [number, number] = [
    v[0] + (dNextX / lenNext) * r,
    v[1] + (dNextY / lenNext) * r,
  ];

  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const omt = 1 - t;
    out.push([
      omt * omt * start[0] + 2 * omt * t * v[0] + t * t * end[0],
      omt * omt * start[1] + 2 * omt * t * v[1] + t * t * end[1],
    ]);
  }
  return out;
}

const BOLT_POLYGON = buildRoundedBolt();
// Tight bounding box of the polygon in normalised 0..1 space.
const BOLT_BBOX = (() => {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const [px, py] of BOLT_POLYGON) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
})();

// Bolt visual footprint inside the QR symbol. The polygon is mapped
// from its tight bbox into a centred region of `BOLT_FOOTPRINT` of
// the symbol's edge length. 0.72 gives a large, dominant bolt while
// leaving a one-finder-square margin on each side — finder squares
// stay structurally readable (they're tinted finder-blue rather than
// recoloured, even if the polygon happens to graze them).
const BOLT_FOOTPRINT = 0.72;

/**
 * Standard ray-casting point-in-polygon test. `poly` is a closed
 * polygon (last vertex implicitly connects to the first).
 */
function pointInPolygon(
  x: number,
  y: number,
  poly: Array<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
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

    const sizeRaw = Number(url.searchParams.get("size") ?? "256");
    const targetSize = Number.isFinite(sizeRaw) ? Math.floor(sizeRaw) : 256;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, Math.round(targetSize / 37)),
    );

    // Raw boolean matrix at ECC=H. Strategy A: recolour dark modules
    // based on whether they fall inside the bolt silhouette. NO modules
    // are skipped — finder, timing, alignment, data all render normally.
    const matrix: boolean[][] = encodeQR(value, "raw", { ecc: "high" });
    const size = matrix.length;
    if (size === 0) {
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

    // Map the bolt polygon's tight bbox into a centred region of the
    // symbol. Modules sit on integer (x, y); we test their centroid
    // (x + 0.5, y + 0.5) in symbol-space, then transform that into
    // bolt-bbox-normalised space for the point-in-polygon check.
    const targetPx = size * BOLT_FOOTPRINT;
    const aspect = BOLT_BBOX.h / BOLT_BBOX.w; // bolt is taller than wide
    const boxW = targetPx;
    const boxH = targetPx * aspect;
    const boxX = (size - boxW) / 2;
    const boxY = (size - boxH) / 2;

    /**
     * True when the module centroid at `(x + 0.5, y + 0.5)` falls
     * inside the rounded bolt silhouette as projected onto the symbol.
     */
    const isInBolt = (x: number, y: number): boolean => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      // To polygon-space (0..1 along the polygon bbox).
      const nx = ((cx - boxX) / boxW) * BOLT_BBOX.w + BOLT_BBOX.minX;
      const ny = ((cy - boxY) / boxH) * BOLT_BBOX.h + BOLT_BBOX.minY;
      if (
        nx < BOLT_BBOX.minX || nx > BOLT_BBOX.maxX ||
        ny < BOLT_BBOX.minY || ny > BOLT_BBOX.maxY
      ) {
        return false;
      }
      return pointInPolygon(nx, ny, BOLT_POLYGON);
    };

    const isFinder = (x: number, y: number) => {
      const inTL = x < 7 && y < 7;
      const inTR = x >= size - 7 && y < 7;
      const inBL = x < 7 && y >= size - 7;
      return inTL || inTR || inBL;
    };

    let greenCount = 0;
    let totalDark = 0;

    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dim * scale}" ` +
        `height="${dim * scale}" viewBox="0 0 ${dim} ${dim}" ` +
        `shape-rendering="crispEdges">`,
    );

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!matrix[y][x]) continue;
        totalDark++;
        // Finder squares stay structurally tinted so the eye still
        // parses the QR's three corners. The bolt does NOT recolour
        // finder modules even when its silhouette overlaps them —
        // keeps the finders' luminance contrast crisp.
        let fill: string;
        if (isFinder(x, y)) {
          fill = FINDER_BLUE;
        } else if (isInBolt(x, y)) {
          fill = GREEN;
          greenCount++;
        } else {
          fill = BLUE;
        }
        parts.push(
          `<rect x="${x + border}" y="${y + border}" width="1" height="1" ` +
            `fill="${fill}"/>`,
        );
      }
    }
    parts.push("</svg>");

    const greenPct = totalDark === 0 ? 0 : (greenCount / totalDark) * 100;
    console.debug(
      `[admin/qr] value=${value.length}ch size=${size}mod ecc=H ` +
        `dark=${totalDark} green=${greenCount} (${greenPct.toFixed(1)}%)`,
    );

    return new Response(parts.join(""), {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
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
