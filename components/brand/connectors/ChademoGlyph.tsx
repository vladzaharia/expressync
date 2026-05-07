/**
 * CHAdeMO connector silhouette — large round body with a 4-pin
 * pattern. Approximation; iOS has no distinct glyph today.
 */

interface ChademoGlyphProps {
  size?: number;
  color?: string;
  class?: string;
  "aria-label"?: string;
}

export function ChademoGlyph(
  { size = 40, color = "currentColor", class: className, ...rest }:
    ChademoGlyphProps,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      class={className}
      role="img"
      aria-label={rest["aria-label"] ?? "CHAdeMO connector"}
      fill="none"
      stroke={color}
      stroke-width={3}
    >
      <circle cx={50} cy={50} r={36} />
      <circle cx={36} cy={36} r={5} />
      <circle cx={64} cy={36} r={5} />
      <circle cx={36} cy={64} r={5} />
      <circle cx={64} cy={64} r={5} />
    </svg>
  );
}
