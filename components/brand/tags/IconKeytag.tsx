import { KeyRound } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * Keytag icon — key with round bow (fob silhouette).
 * Represents a keychain-style RFID fob.
 */
export function IconKeytag(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <KeyRound
      width={px}
      height={px}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export default IconKeytag;
