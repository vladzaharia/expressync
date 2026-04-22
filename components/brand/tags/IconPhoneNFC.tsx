import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * Phone NFC icon — smartphone silhouette with a small radiating NFC arc
 * emanating from the top-right corner. Composed as a single SVG so the
 * wave aligns precisely with the phone at every size.
 *
 * Uses `currentColor` for both stroke and the emitting arcs.
 */
export function IconPhoneNFC(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* Smartphone body (slightly narrowed to leave room for the waves). */}
      <rect x="3" y="3" width="11" height="18" rx="2" ry="2" />
      {/* Home indicator / speaker slot. */}
      <path d="M7.5 18h3" />
      {/* NFC emission arcs radiating from the top-right. */}
      <path d="M17 7a3 3 0 0 1 0 4" />
      <path d="M19.5 5a6 6 0 0 1 0 8" />
    </svg>
  );
}

export default IconPhoneNFC;
