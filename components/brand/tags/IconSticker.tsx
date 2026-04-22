import { Tag } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * Sticker icon — price-tag/label glyph with punched hole.
 * Represents an adhesive NFC sticker.
 */
export function IconSticker(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <Tag
      width={px}
      height={px}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export default IconSticker;
