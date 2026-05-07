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
import { IconPhoneNFC } from "./IconPhoneNFC.tsx";
import { IconOther } from "./IconOther.tsx";

export { IconEVCard, IconKeytag, IconOther, IconPhoneNFC };
export type { TagIconProps };

/**
 * One icon per `TagType`. The four-value taxonomy maps to:
 *   ev_card → physical EV card silhouette
 *   keytag  → keychain-fob silhouette
 *   app     → phone-NFC silhouette (customer iOS device tags + any
 *             other app-mediated identity)
 *   meta    → neutral "other" silhouette so admin Tags listings show
 *             meta-tags distinctly from the three card form factors
 */
export const tagTypeIcons: Record<TagType, FunctionComponent<TagIconProps>> = {
  ev_card: IconEVCard,
  keytag: IconKeytag,
  app: IconPhoneNFC,
  meta: IconOther,
};
