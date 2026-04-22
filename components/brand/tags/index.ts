/**
 * Tag form-factor icons — one per `TagType` in `src/lib/types/tags.ts`.
 *
 * Usage:
 *   const Icon = tagTypeIcons[tag.tagType];
 *   <Icon size="md" class="text-blue-500" />
 *
 * All icons accept `{ size?: "sm" | "md" | "lg"; class?: string }` and
 * render in `currentColor` so color is controlled by the parent's Tailwind
 * text-color class.
 */
import type { FunctionComponent } from "preact";
import type { TagType } from "@/src/lib/types/tags.ts";
import type { TagIconProps } from "./types.ts";

import { IconEVCard } from "./IconEVCard.tsx";
import { IconKeytag } from "./IconKeytag.tsx";
import { IconSticker } from "./IconSticker.tsx";
import { IconPhoneNFC } from "./IconPhoneNFC.tsx";
import { IconGuestQR } from "./IconGuestQR.tsx";
import { IconApp } from "./IconApp.tsx";
import { IconOther } from "./IconOther.tsx";

export {
  IconApp,
  IconEVCard,
  IconGuestQR,
  IconKeytag,
  IconOther,
  IconPhoneNFC,
  IconSticker,
};
export type { TagIconProps };

export const tagTypeIcons: Record<TagType, FunctionComponent<TagIconProps>> = {
  ev_card: IconEVCard,
  keytag: IconKeytag,
  sticker: IconSticker,
  phone_nfc: IconPhoneNFC,
  guest_qr: IconGuestQR,
  app: IconApp,
  other: IconOther,
};
