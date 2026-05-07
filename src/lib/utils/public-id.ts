/**
 * Public ID generation for chargers and users.
 *
 * 8-char NanoID drawn from a 28-char Crockford-ish alphabet
 * (digits 2–9, letters A–Z minus O, I, L, U). Optimised for human
 * readability on physical stickers — no characters that could be
 * confused for one another at typeable size (no `0/O`, `1/I/L`,
 * `U/V`).
 *
 * Used everywhere a charger or a user is referenced by a stable,
 * sticker-printable identity: QR codes, public landing URLs, the
 * top-right watermark on detail pages, the iOS in-app display.
 */

import { customAlphabet } from "nanoid";

export const PUBLIC_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PUBLIC_ID_LENGTH = 8;
export const PUBLIC_ID_GROUP_SIZE = 4;

const generator = customAlphabet(PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH);

export function generatePublicId(): string {
  return generator();
}

export function isValidPublicId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length !== PUBLIC_ID_LENGTH) return false;
  for (const ch of value) {
    if (!PUBLIC_ID_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * Splits an 8-char ID into two 4-char groups for UI rendering.
 * Returns `["ABCD", "EFGH"]` for `"ABCDEFGH"`.
 */
export function splitPublicId(id: string): [string, string] {
  return [id.slice(0, PUBLIC_ID_GROUP_SIZE), id.slice(PUBLIC_ID_GROUP_SIZE)];
}

/**
 * Hyphen-separated form for plain-text contexts (logs, audit
 * metadata, copy-to-clipboard). UI rendering uses
 * `<PublicIdDisplay>` which colours digits and letters separately.
 */
export function formatPublicId(id: string): string {
  const [a, b] = splitPublicId(id);
  return `${a}-${b}`;
}
