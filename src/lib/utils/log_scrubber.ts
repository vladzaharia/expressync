/**
 * Defence-in-depth PII redactor for OTel-shaped log records emitted by
 * `src/lib/utils/logger.ts`. The iOS-side mirror lives at
 * `Sources/DeviceLogging/LogScrubber.swift` (ExpresScan repo); both
 * implementations are validated against the shared fixture corpus at
 * `docs/logging/scrubber-fixtures.json`.
 *
 * Why a regex deny-list rather than typed redaction? Most logs are
 * free-form `body` strings; we don't control every interpolation site.
 * A coarse regex pass catches the common shapes (emails, JWTs, bearer
 * tokens, phone numbers) without forcing every call site to use
 * structured metadata. Structured `attributes` keys whose NAMES
 * indicate sensitivity (e.g. `card_*`, `Authorization`, `cookie`)
 * get their VALUES wholesale-redacted regardless of content.
 *
 * Order matters: JWT before bearer before email — JWTs match the
 * bearer regex.
 */

const REDACTED = "<redacted>";

// Keep these in sync with iOS LogScrubber and the fixture corpus.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9._\-]{8,}/g;
const PHONE_E164 = /\+\d{7,15}\b/g;

const SENSITIVE_ATTR_KEYS = new Set([
  "authorization",
  "x-auth-token",
  "cookie",
  "set-cookie",
]);

const SENSITIVE_ATTR_KEY_PREFIXES = ["card_"];

function isSensitiveAttrKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_ATTR_KEYS.has(lower)) return true;
  return SENSITIVE_ATTR_KEY_PREFIXES.some((p) => lower.startsWith(p));
}

export function scrubString(input: string): string {
  if (!input) return input;
  return input
    .replace(JWT, "<jwt>")
    .replace(BEARER, "Bearer <token>")
    .replace(EMAIL, "<email>")
    .replace(PHONE_E164, "<phone>");
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveAttrKey(k) ? REDACTED : scrubValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Scrub the `body` and every string-valued `attributes` entry of an
 * OTel-shaped record. `resource` is left intact — it never carries PII
 * by construction (`service.name`, `service.version`,
 * `deployment.environment`).
 */
export function scrubAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes)) {
    out[k] = isSensitiveAttrKey(k) ? REDACTED : scrubValue(v);
  }
  return out;
}
