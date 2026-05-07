/**
 * Shared Tailwind class maps for tag-form-factor visuals. Previously duplicated
 * inline across `TagMetadataForm`, `NewTagForm`, `MappingForm`, `TagLinkingGrid`,
 * and `routes/tags/index.tsx`. Tailwind's JIT needs the full class string
 * present somewhere in source; these constants satisfy that while giving
 * every consumer a single source of truth.
 *
 * Keep these three maps in lockstep with `TAG_TYPES` in `src/lib/types/tags.ts`.
 */

import type { TagType } from "./types/tags.ts";

/** Foreground color — use for icons and emphasized text. */
export const tagTypeTextClass: Record<TagType, string> = {
  ev_card: "text-blue-500 dark:text-blue-400",
  keytag: "text-emerald-500 dark:text-emerald-400",
  app: "text-cyan-500 dark:text-cyan-400",
  meta: "text-violet-500 dark:text-violet-400",
};

/** Matching soft-tint background — use for icon pills / chip fills. */
export const tagTypeBgClass: Record<TagType, string> = {
  ev_card: "bg-blue-500/10",
  keytag: "bg-emerald-500/10",
  app: "bg-cyan-500/10",
  meta: "bg-violet-500/10",
};

/** Border-plus-fill variant — use for selection states in type pickers. */
export const tagTypeBorderClass: Record<TagType, string> = {
  ev_card: "border-blue-500 bg-blue-500/5",
  keytag: "border-emerald-500 bg-emerald-500/5",
  app: "border-cyan-500 bg-cyan-500/5",
  meta: "border-violet-500 bg-violet-500/5",
};
