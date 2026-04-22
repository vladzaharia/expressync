/**
 * Polaris Track A — friendly error messages shown to customers.
 *
 * Copy guidelines (from the plan):
 *   - Never use words like "BLOCKED", "FORBIDDEN", "DENIED", "UNAUTHORIZED".
 *   - Phrasing is "currently …", "to do this, contact your operator".
 *   - Friendly and not punitive — assume good intent.
 *   - Each message is short (<120 chars) so it fits in a toast or banner.
 *
 * `mapServiceError()` in `error-scrubber.ts` translates internal errors to
 * one of these strings.
 */

export const CUSTOMER_ERROR_COPY = {
  /** Default catch-all. Used when no specific mapping fits. */
  GENERIC:
    "Something went wrong on our end. Please try again in a moment, or contact your operator if it persists.",

  // ----- Auth -----
  MAGIC_LINK_EXPIRED:
    "This sign-in link has expired. Please request a new one from the login page.",
  MAGIC_LINK_USED:
    "This sign-in link has already been used. Please request a new one if you need to sign in again.",
  MAGIC_LINK_INVALID:
    "This sign-in link is invalid. Please request a new one from the login page.",
  SESSION_EXPIRED: "Your session has ended. Please sign in again to continue.",
  ACCOUNT_INACTIVE:
    "Your account is currently inactive. You can review your history; to start charging again, contact your operator.",
  CAPABILITY_DENIED_INACTIVE:
    "This action isn't available right now because your account is inactive. Contact your operator to reactivate.",
  CAPABILITY_DENIED_ROLE:
    "This action isn't available on your account. If you think this is a mistake, contact your operator.",

  // ----- Origin / CSRF -----
  ORIGIN_MISMATCH:
    "This request looks suspicious to our security checks. Please refresh the page and try again.",

  // ----- Charging -----
  CHARGER_OFFLINE:
    "That charger isn't responding right now. Please try again, or pick another charger.",
  CHARGER_UNAVAILABLE:
    "We can't reach the charger at the moment. Please try again in a few seconds.",
  SESSION_NOT_FOUND:
    "We couldn't find that charging session. It may have been removed.",
  RESERVATION_NOT_FOUND: "We couldn't find that reservation.",
  RESERVATION_CONFLICT:
    "Another reservation already covers part of that time window. Please pick a different time.",

  // ----- Billing -----
  BILLING_UNAVAILABLE:
    "Billing is temporarily unavailable. Please try again in a few minutes.",
  LAGO_CUSTOMER_NOT_FOUND:
    "We couldn't find your billing record. Please contact your operator.",
  INVOICE_NOT_FOUND: "We couldn't find that invoice.",

  // ----- Network -----
  UPSTREAM_TIMEOUT:
    "That took longer than expected. Please try again — it usually works on a retry.",
  RATE_LIMITED:
    "You're doing that a bit too quickly. Please wait a moment and try again.",
  NOT_FOUND_GENERIC: "We couldn't find what you were looking for.",
} as const;

export type CustomerErrorKey = keyof typeof CUSTOMER_ERROR_COPY;
