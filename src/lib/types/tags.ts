/**
 * Tag type taxonomy — single source of truth for UI selector and server validation.
 *
 * Every tag in `user_mappings` is categorized by its physical/digital form factor.
 * Changing the type is purely metadata — it does NOT trigger a StEvE call.
 */

export const TAG_TYPES = [
  "ev_card",
  "keytag",
  "sticker",
  "phone_nfc",
  "guest_qr",
  "app",
  "other",
] as const;

export type TagType = typeof TAG_TYPES[number];

/**
 * Type guard for validating untrusted input against the allowlist.
 * Consumed by API routes that accept `tag_type` in POST bodies.
 */
export function isTagType(value: unknown): value is TagType {
  return typeof value === "string" &&
    (TAG_TYPES as readonly string[]).includes(value);
}

/**
 * Human-readable labels for each tag type. Rendered in the type selector + tooltips.
 */
export const tagTypeLabels: Record<TagType, string> = {
  ev_card: "EV Card",
  keytag: "Keytag",
  sticker: "Sticker",
  phone_nfc: "Phone NFC",
  guest_qr: "Guest QR",
  app: "App",
  other: "Other",
};

/**
 * Accent color per tag type — keys align with `AccentColor` in `src/lib/colors.ts`.
 * Drives icon color in cards + selector.
 */
export const tagTypeColors: Record<TagType, string> = {
  ev_card: "blue",
  keytag: "emerald",
  sticker: "rose",
  phone_nfc: "cyan",
  guest_qr: "amber",
  app: "purple",
  other: "slate",
};

/**
 * Heuristic inference from idTag string. Always user-overridable in the UI.
 *
 * Heuristics (in order):
 *   - 14 hex chars   -> ev_card     (7-byte ISO14443A serial, typical EV RFID card)
 *   - 8 hex chars    -> keytag      (4-byte short UID, typical keytag/fob)
 *   - "QR-" prefix   -> guest_qr
 *   - "APP-" prefix  -> app
 *   - fallback       -> other
 */
export function inferTagType(idTag: string): TagType {
  if (/^[0-9A-F]{14}$/i.test(idTag)) return "ev_card";
  if (/^[0-9A-F]{8}$/i.test(idTag)) return "keytag";
  if (/^QR-/.test(idTag)) return "guest_qr";
  if (/^APP-/.test(idTag)) return "app";
  return "other";
}
