/**
 * Tag type taxonomy — single source of truth for UI selector and server validation.
 *
 * Every tag in `user_mappings` is categorized by its physical/digital form factor.
 * Changing the type is purely metadata — it does NOT trigger a StEvE call.
 *
 * Simplified to four values in migration 0048 (2026-05-07). Older
 * values were remapped:
 *   keytag    → keychain
 *   sticker   → ev_card
 *   phone_nfc → app
 *   guest_qr  → app
 *   other     → ev_card
 */

export const TAG_TYPES = [
  "ev_card",
  "keytag",
  "app",
  "meta",
] as const;

export type TagType = typeof TAG_TYPES[number];

/**
 * Subset rendered in the admin tag-type picker. Both `meta` and `app`
 * are excluded because:
 *   - `meta` is auto-set by `ensureCustomerMetaTag` for customer
 *     parent tags.
 *   - `app` is auto-set by `ensureDeviceTag` when a customer device
 *     registers via the iOS QR flow.
 * Admins re-classifying either by hand would diverge the on-card
 * label from the actual tag origin, so keep the picker honest by
 * showing only the human-issuable categories.
 */
export const USER_SELECTABLE_TAG_TYPES = [
  "ev_card",
  "keytag",
] as const;

export type UserSelectableTagType = typeof USER_SELECTABLE_TAG_TYPES[number];

/**
 * Type guard for validating untrusted input against the allowlist.
 * Consumed by API routes that accept `tag_type` in POST bodies.
 */
export function isTagType(value: unknown): value is TagType {
  return typeof value === "string" &&
    (TAG_TYPES as readonly string[]).includes(value);
}

/**
 * Type guard for the user-selectable subset. Endpoints that mutate a
 * tag's type from the admin UI use this to keep `meta` out of the
 * write path.
 */
export function isUserSelectableTagType(
  value: unknown,
): value is UserSelectableTagType {
  return typeof value === "string" &&
    (USER_SELECTABLE_TAG_TYPES as readonly string[]).includes(value);
}

/**
 * Human-readable labels for each tag type. Rendered in the type selector + tooltips.
 */
export const tagTypeLabels: Record<TagType, string> = {
  ev_card: "EV Card",
  keytag: "Keytag",
  app: "App",
  meta: "Meta-tag",
};

/**
 * Accent color per tag type — keys align with `AccentColor` in `src/lib/colors.ts`.
 * Drives icon color in cards + selector.
 */
export const tagTypeColors: Record<TagType, string> = {
  ev_card: "blue",
  keytag: "emerald",
  app: "cyan",
  meta: "violet",
};

/**
 * Heuristic inference from idTag string. Always user-overridable in the UI
 * (subject to the user-selectable subset — admins can't pick `meta`).
 *
 * Order of checks:
 *   - META-* / OCPP-* (excluding OCPP-D-*) → meta (parent meta-tag)
 *   - OCPP-D-*  → app (per-device customer tag)
 *   - APP-* / QR-* prefixes → app
 *   - 14 hex chars → ev_card (7-byte ISO14443A serial)
 *   - 8 hex chars  → keychain (4-byte short UID, typical keychain fob)
 *   - fallback     → ev_card (safest default for an unrecognised RFID)
 */
export function inferTagType(idTag: string): TagType {
  if (/^META-/.test(idTag)) return "meta";
  if (/^OCPP-(?!D-)/.test(idTag)) return "meta";
  if (/^OCPP-D-/.test(idTag)) return "app";
  if (/^APP-/.test(idTag)) return "app";
  if (/^QR-/.test(idTag)) return "app";
  if (/^[0-9A-F]{14}$/i.test(idTag)) return "ev_card";
  if (/^[0-9A-F]{8}$/i.test(idTag)) return "keytag";
  return "ev_card";
}
