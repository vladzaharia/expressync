import { CreditCard } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { TagIconProps } from "./types.ts";

const sizeMap = { sm: 16, md: 20, lg: 24 } as const;

/**
 * EV Card icon — credit-card glyph with horizontal chip stripe.
 * Represents a standard RFID/NFC access card.
 */
export function IconEVCard(
  { size = "md", class: className }: TagIconProps,
) {
  const px = sizeMap[size];
  return (
    <CreditCard
      width={px}
      height={px}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export default IconEVCard;
