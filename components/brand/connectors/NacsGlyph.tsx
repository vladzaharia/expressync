/**
 * NACS / Tesla connector silhouette — web port of
 * `ExpresScan/App/Design/Components/NACSIcon.swift`. A smooth circle
 * (no release-latch tab), centred and radiused identically to the
 * J1772 body so the two glyphs sit at the same y-position when used
 * adjacent in lists.
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
    >
      <circle cx={50} cy={60} r={32} />
    </svg>
  );
}
