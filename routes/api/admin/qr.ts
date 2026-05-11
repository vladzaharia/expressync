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
// Source: the exact `Zap` glyph rendered in the admin sidebar — the
// current Lucide path (lucide-preact 0.511.0 icons/zap.js) which uses
// elliptical arcs at every corner rather than the older straight-line
// Zap (M13 2 L3 14 …). That older path is what the hand-rolled
// rounded polygon used to approximate; this version matches the
// nav-bar logo byte-for-byte.
//
// The path is parsed once at module load and sampled into a flat
// polygon — line-segments + small arc samples — that the
// point-in-polygon test below can scan. Native 24×24 viewBox space,
// then normalised to 0..1 before use.

const LUCIDE_ZAP_PATH =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

const ARC_STEPS_PER_RADIAN = 14;

interface PathToken {
  cmd: string;
  args: number[];
}

/**
 * Tokenise an SVG path into `{cmd, args}` pairs via `String.matchAll`.
 * Handles signed/unsigned floats including the no-separator form
 * (`1.5-2.3` → `[1.5, -2.3]`).
 */
function tokeniseSvgPath(p: string): PathToken[] {
  const out: PathToken[] = [];
  const cmdRe = /([MLlhHaAzZ])([^MLlhHaAzZ]*)/g;
  const numRe = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
  for (const m of p.matchAll(cmdRe)) {
    const cmd = m[1];
    const args: number[] = [];
    const argStr = m[2].trim();
    if (argStr.length > 0) {
      for (const nm of argStr.matchAll(numRe)) args.push(parseFloat(nm[0]));
    }
    out.push({ cmd, args });
  }
  return out;
}

/**
 * SVG 1.1 §F.6.5 endpoint-to-centre parameterisation. Samples an
 * elliptic arc and returns the new points (start is assumed already
 * in the polygon).
 */
function sampleSvgArc(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number,
): Array<[number, number]> {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (xAxisRotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const sq = ((rx * rx * ry * ry) - (rx * rx * y1p * y1p) -
    (ry * ry * x1p * x1p)) /
    ((rx * rx * y1p * y1p) + (ry * ry * x1p * x1p));
  const coef = sign * Math.sqrt(Math.max(0, sq));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (sweepFlag === 0 && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
  if (sweepFlag === 1 && deltaTheta < 0) deltaTheta += 2 * Math.PI;
  const steps = Math.max(
    2,
    Math.ceil(Math.abs(deltaTheta) * ARC_STEPS_PER_RADIAN),
  );
  const out: Array<[number, number]> = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const theta = theta1 + deltaTheta * t;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    out.push([
      cosPhi * (rx * cosT) - sinPhi * (ry * sinT) + cx,
      sinPhi * (rx * cosT) + cosPhi * (ry * sinT) + cy,
    ]);
  }
  return out;
}

/**
 * Walk the tokenised path, emitting a flat polygon in 0..1 space
 * (divided by the 24-unit Lucide viewBox edge). Handles M, L/l, h/H,
 * A/a, Z/z — the subset Lucide's Zap actually uses.
 */
function buildLucideZapPolygon(): Array<[number, number]> {
  const tokens = tokeniseSvgPath(LUCIDE_ZAP_PATH);
  const poly: Array<[number, number]> = [];
  let cx = 0, cy = 0, startX = 0, startY = 0;
  for (const t of tokens) {
    switch (t.cmd) {
      case "M":
        cx = t.args[0];
        cy = t.args[1];
        startX = cx;
        startY = cy;
        poly.push([cx / 24, cy / 24]);
        break;
      case "L":
        for (let i = 0; i < t.args.length; i += 2) {
          cx = t.args[i];
          cy = t.args[i + 1];
          poly.push([cx / 24, cy / 24]);
        }
        break;
      case "l":
        for (let i = 0; i < t.args.length; i += 2) {
          cx += t.args[i];
          cy += t.args[i + 1];
          poly.push([cx / 24, cy / 24]);
        }
        break;
      case "h":
        for (const d of t.args) {
          cx += d;
          poly.push([cx / 24, cy / 24]);
        }
        break;
      case "H":
        for (const x of t.args) {
          cx = x;
          poly.push([cx / 24, cy / 24]);
        }
        break;
      case "A":
      case "a": {
        const rel = t.cmd === "a";
        for (let i = 0; i < t.args.length; i += 7) {
          const rx = t.args[i];
          const ry = t.args[i + 1];
          const rot = t.args[i + 2];
          const large = t.args[i + 3];
          const sweep = t.args[i + 4];
          let x2 = t.args[i + 5];
          let y2 = t.args[i + 6];
          if (rel) {
            x2 += cx;
            y2 += cy;
          }
          const samples = sampleSvgArc(
            cx,
            cy,
            rx,
            ry,
            rot,
            large,
            sweep,
            x2,
            y2,
          );
          for (const [sx, sy] of samples) poly.push([sx / 24, sy / 24]);
          cx = x2;
          cy = y2;
        }
        break;
      }
      case "z":
      case "Z":
        cx = startX;
        cy = startY;
        break;
    }
  }
  return poly;
}

const BOLT_POLYGON = buildLucideZapPolygon();
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
