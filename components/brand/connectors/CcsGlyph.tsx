/**
 * CCS Combo connector silhouette — J1772 face on top, two larger DC
 * pin sockets below. Approximates CCS Combo 1 (North America). iOS
 * doesn't have a distinct CCS glyph today (it falls back to J1772
 * for everything that isn't NACS); the web glyphs are a parity
 * upgrade we should backport to iOS in a follow-up.
 */

interface CcsGlyphProps {
  size?: number;
  color?: string;
  class?: string;
  "aria-label"?: string;
}

const VIEW = 100;
const TOP_CX = 50;
const TOP_CY = 36;
const TOP_R = 22;
const LATCH_HALF_WIDTH = 8;
const LATCH_TOP = 6;
const dx = LATCH_HALF_WIDTH;
const dy = Math.sqrt(TOP_R * TOP_R - dx * dx);
const joinY = TOP_CY - dy;

const TOP_PATH = `M ${TOP_CX + dx} ${joinY}
   A ${TOP_R} ${TOP_R} 0 1 0 ${TOP_CX - dx} ${joinY}
   L ${TOP_CX - dx} ${LATCH_TOP}
   L ${TOP_CX + dx} ${LATCH_TOP}
   Z`.replace(/\s+/g, " ").trim();

export function CcsGlyph(
  { size = 40, color = "currentColor", class: className, ...rest }:
    CcsGlyphProps,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      class={className}
      role="img"
      aria-label={rest["aria-label"] ?? "CCS Combo connector"}
      fill="none"
      stroke={color}
      stroke-width={3}
      stroke-linejoin="round"
    >
      {/* J1772-style top half */}
      <path d={TOP_PATH} />
      {/* Two DC pin sockets stacked below */}
      <circle cx={36} cy={78} r={9} />
      <circle cx={64} cy={78} r={9} />
    </svg>
  );
}
