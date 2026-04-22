import { HelpCircle } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * Other icon — question-mark-in-circle.
 * Represents an unspecified or legacy tag form factor.
 */
export function IconOther(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <HelpCircle
      width={px}
      height={px}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export default IconOther;
