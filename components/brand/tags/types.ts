/**
 * Shared prop contract for every tag-type icon in `components/brand/tags/`.
 *
 * All icons render in `currentColor`, so color flows from the parent's Tailwind
 * text-color class (e.g., `text-blue-500`). Size resolves to pixel dimensions.
 */
export interface TagIconProps {
  /** sm=16px, md=20px (default), lg=24px */
  size?: "sm" | "md" | "lg";
  /** Preact-style class prop (forwarded to the root SVG). */
  class?: string;
}
