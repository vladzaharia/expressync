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
 * One icon per `TagType`. The four-value taxonomy (post-0048) maps to:
 *   ev_card  → physical EV card silhouette
 *   keychain → keychain fob (renamed from keytag, same icon)
 *   app      → phone-NFC silhouette — covers customer iOS device tags
 *              and any other app-mediated identity
 *   meta     → neutral "other" silhouette so admin Tags listings can
 *              show meta-tags distinctly from the three card form
 *              factors without introducing a brand-new icon for a
 *              non-card construct
 */
export const tagTypeIcons: Record<TagType, FunctionComponent<TagIconProps>> = {
  ev_card: IconEVCard,
  keychain: IconKeytag,
  app: IconPhoneNFC,
  meta: IconOther,
};
