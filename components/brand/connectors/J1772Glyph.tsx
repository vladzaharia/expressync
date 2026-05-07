/**
 * J1772 connector silhouette — web port of
 * `ExpresScan/App/Design/Components/J1772Icon.swift`.
 *
 * Renders the same circle + rectangular release-latch profile in a
 * 100×100 viewBox so the web glyph and iOS Canvas drawing read as the
 * same product when seen side-by-side. Latch geometry uses
 * `latchHalfWidth = 11` (matches the post-Track-I2 iOS value, which
 * widens the lock for better proportions at small sizes).
 *
 * Stroke-only — no halo. Halo treatments belong on the iOS hero
 * artwork, not on the small spec-sheet glyph the web `ConnectorSpec`
 * embeds beside text.
 */

interface J1772GlyphProps {
  /** Pixel side-length. */
  size?: number;
  /** Stroke colour. Defaults to `currentColor` so the glyph inherits
   *  text colour from the surrounding `ConnectorSpec`. */
  color?: string;
  class?: string;
  "aria-label"?: string;
}

const VIEW = 100;
const BODY_CX = 50;
const BODY_CY = 60;
const BODY_R = 32;
const LATCH_HALF_WIDTH = 11;
const LATCH_TOP = 14;

// Tangent-y where the latch sides meet the circle.
const dx = LATCH_HALF_WIDTH;
const dy = Math.sqrt(BODY_R * BODY_R - dx * dx);
const joinY = BODY_CY - dy;

// Closed path: arc around the body, then up-across-down the latch.
const PATH_D = `M ${BODY_CX + dx} ${joinY}
   A ${BODY_R} ${BODY_R} 0 1 0 ${BODY_CX - dx} ${joinY}
   L ${BODY_CX - dx} ${LATCH_TOP}
   L ${BODY_CX + dx} ${LATCH_TOP}
   Z`.replace(/\s+/g, " ").trim();

export function J1772Glyph(
  { size = 40, color = "currentColor", class: className, ...rest }:
    J1772GlyphProps,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      class={className}
      role="img"
      aria-label={rest["aria-label"] ?? "J1772 connector"}
      fill="none"
      stroke={color}
      stroke-width={3}
      stroke-linejoin="round"
    >
      <path d={PATH_D} />
    </svg>
  );
}
