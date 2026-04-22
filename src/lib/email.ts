/**
 * Polaris Track A — email client stub.
 *
 * **TEMPORARY STUB** — Track D is implementing the real email subsystem
 * (Cloudflare Worker client + unified template). Track A only needs a
 * minimal export so `auth.ts`'s magic-link plugin can `await sendCustomerMagicLink(...)`
 * without crashing.
 *
 * Once Track D lands, this file is overwritten with the real implementation.
 *
 * Behavior in this stub:
 *   - Logs the email + URL to the console (visible in dev workflow + tests).
 *   - Returns immediately without touching any network resource.
 *   - Never throws — magic-link issuance must never fail because email
 *     delivery is unavailable.
 *
 * This keeps Track A buildable + testable in isolation.
 */

/**
 * Send a magic-link email to a customer.
 *
 * @param email Recipient email address
 * @param url   Sign-in URL (already includes the magic-link token)
 *
 * STUB — Track D replaces this with the real Cloudflare Worker client call.
 */
export function sendCustomerMagicLink(
  email: string,
  url: string,
): Promise<void> {
  console.log("[email-stub] sendCustomerMagicLink", { email, url });
  return Promise.resolve();
}

/**
 * Send a password-reset email to an admin.
 *
 * @param email Recipient email address
 * @param url   Reset URL (already includes the reset token)
 *
 * STUB — Track D replaces this with the real Cloudflare Worker client call.
 */
export function sendAdminPasswordReset(
  email: string,
  url: string,
): Promise<void> {
  console.log("[email-stub] sendAdminPasswordReset", { email, url });
  return Promise.resolve();
}

/**
 * Send a session-summary email after a charging session completes.
 *
 * STUB — Track D replaces this with the real Cloudflare Worker client call.
 */
export function sendSessionSummary(
  email: string,
  data: Record<string, unknown>,
): Promise<void> {
  console.log("[email-stub] sendSessionSummary", { email, data });
  return Promise.resolve();
}

/**
 * Send a reservation-cancelled notification email.
 *
 * STUB — Track D replaces this with the real Cloudflare Worker client call.
 */
export function sendReservationCancelled(
  email: string,
  data: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  console.log("[email-stub] sendReservationCancelled", {
    email,
    data,
    reason,
  });
  return Promise.resolve();
}
