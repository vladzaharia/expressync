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
  sticker: "text-rose-500 dark:text-rose-400",
  phone_nfc: "text-cyan-500 dark:text-cyan-400",
  guest_qr: "text-amber-500 dark:text-amber-400",
  app: "text-purple-500 dark:text-purple-400",
  other: "text-slate-500 dark:text-slate-400",
};

/** Matching soft-tint background — use for icon pills / chip fills. */
export const tagTypeBgClass: Record<TagType, string> = {
  ev_card: "bg-blue-500/10",
  keytag: "bg-emerald-500/10",
  sticker: "bg-rose-500/10",
  phone_nfc: "bg-cyan-500/10",
  guest_qr: "bg-amber-500/10",
  app: "bg-purple-500/10",
  other: "bg-slate-500/10",
};

/** Border-plus-fill variant — use for selection states in type pickers. */
export const tagTypeBorderClass: Record<TagType, string> = {
  ev_card: "border-blue-500 bg-blue-500/5",
  keytag: "border-emerald-500 bg-emerald-500/5",
  sticker: "border-rose-500 bg-rose-500/5",
  phone_nfc: "border-cyan-500 bg-cyan-500/5",
  guest_qr: "border-amber-500 bg-amber-500/5",
  app: "border-purple-500 bg-purple-500/5",
  other: "border-slate-500 bg-slate-500/5",
};
