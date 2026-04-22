import { Smartphone } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * App icon — smartphone outline (no radio waves — that's reserved for Phone NFC).
 * Represents a purely-digital in-app authorization.
 */
export function IconApp(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <Smartphone
      width={px}
      height={px}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export default IconApp;
