/**
 * NACS / SAE J3400 (Tesla) connector face — web port of
 * `ExpresScan/App/Design/Components/NACSIcon.swift`. Distinguished
 * from J1772 by:
 *   - slightly wider-than-tall outer silhouette (no latch tab), and
 *   - two large filled pin holes side-by-side in the upper half of
 *     the face (DC+/DC− on DC, L1/L2 on AC). The three smaller pins
 *     (CP, PP, G) are intentionally omitted at icon scale.
 *
 * Centre matches J1772's so adjacent glyphs sit at the same y.
 */

interface NacsGlyphProps {
  size?: number;
  color?: string;
  class?: string;
  "aria-label"?: string;
}

export function NacsGlyph(
  { size = 40, color = "currentColor", class: className, ...rest }:
    NacsGlyphProps,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      class={className}
      role="img"
      aria-label={rest["aria-label"] ?? "NACS connector"}
      fill="none"
      stroke={color}
      stroke-width={3}
      stroke-linejoin="round"
    >
      {/* Body — wider-than-tall ellipse, no latch tab */}
      <ellipse cx={50} cy={60} rx={34} ry={30} />
      {/* Two large filled pins in the upper half */}
      <circle cx={39} cy={53} r={7} fill={color} stroke="none" />
      <circle cx={61} cy={53} r={7} fill={color} stroke="none" />
    </svg>
  );
}
