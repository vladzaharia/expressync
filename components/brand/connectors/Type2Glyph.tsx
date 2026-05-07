/**
 * Type 2 (Mennekes) connector silhouette — flattened-top circle with
 * a flat across the top edge and a small notch. Approximation.
 */

interface Type2GlyphProps {
  size?: number;
  color?: string;
  class?: string;
  "aria-label"?: string;
}

const VIEW = 100;
const CX = 50;
const CY = 56;
const R = 34;
// Flatten the top of the circle: the chord is at y = CY - flatOffset.
const FLAT_Y = 24;
// Half-chord width derived from the radius and chord position.
const halfChord = Math.sqrt(R * R - (CY - FLAT_Y) * (CY - FLAT_Y));

const PATH_D = `M ${CX - halfChord} ${FLAT_Y}
   L ${CX + halfChord} ${FLAT_Y}
   A ${R} ${R} 0 1 0 ${CX - halfChord} ${FLAT_Y}
   Z`.replace(/\s+/g, " ").trim();

export function Type2Glyph(
  { size = 40, color = "currentColor", class: className, ...rest }:
    Type2GlyphProps,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      class={className}
      role="img"
      aria-label={rest["aria-label"] ?? "Type 2 connector"}
      fill="none"
      stroke={color}
      stroke-width={3}
      stroke-linejoin="round"
    >
      <path d={PATH_D} />
    </svg>
  );
}
