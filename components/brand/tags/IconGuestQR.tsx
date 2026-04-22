import { QrCode } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * Guest QR icon — QR-code square with finder patterns in three corners.
 * Represents a short-lived guest access code.
 */
export function IconGuestQR(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <QrCode
      width={px}
      height={px}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export default IconGuestQR;
