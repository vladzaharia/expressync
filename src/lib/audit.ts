/**
 * Polaris Track A — authentication audit helpers.
 *
 * Centralized writers for the `auth_audit` table. Each helper is a thin
 * wrapper around `logAuthEvent` to keep call sites legible and the event
 * names canonical (typo'd events are silent gaps in forensics).
 *
 * Best-effort: all helpers swallow database errors (logging only) so an
 * audit-table outage never breaks a real auth flow. The DB is not allowed
 * to fail closed on something as load-bearing as login.
 *
 * Email values are sha256-hashed before insertion — plaintext emails are
 * never stored in this table. See `hashEmail()` below.
 */

import { authAudit, type NewAuthAudit } from "../db/schema.ts";
import { db } from "../db/index.ts";

/**
 * Canonical list of audit event identifiers. Centralizing the strings here
 * makes it easy to grep for usage and prevents the inevitable
 * `magic_link.requeted` typo from going unnoticed.
 */
export type AuthAuditEvent =
  | "magic_link.requested"
  | "magic_link.consumed"
  | "magic_link.failed"
  | "magic_link.attempted_at_wrong_surface"
  | "scan.login_success"
  | "scan.login_failed"
  | "scan.paired"
  | "scan.released"
  | "scan.detected"
  | "password.login_success"
  | "password.login_failed"
  | "password.reset_requested"
  | "password.reset_completed"
  | "password.reset_attempted_for_non_admin"
  | "session.revoked"
  | "session.expired_customer_ttl"
  | "impersonation.start"
  | "impersonation.end"
  | "impersonation.write_blocked"
  | "capability.denied"
  | "privilege_violation"
  | "customer.account.auto_provisioned"
  | "customer.account.auto_create_blocked_admin_email"
  /**
   * Customer-initiated mutations (start charge, stop session, create
   * reservation, etc.). Concrete action stored in `metadata.action`.
   */
  | "customer.action"
  // ===========================================================================
  // ExpresScan / Wave 1 Track A — device lifecycle events.
  // See `expresscan/docs/plan/60-security.md` §12 for the canonical list and
  // payload conventions. Common payload contract:
  //   - `userId`         actor (admin / device-owner) when known
  //   - `metadata.deviceId`  always
  //   - `metadata.tokenId`   for token.* events
  //   - `metadata.hashPrefix` first 8 hex chars of sha256(rawToken) — used
  //                            by token.invalid / token.issued for probe
  //                            detection without exposing the raw token.
  //   - `metadata.idTagPrefix` first 4 chars of the hex idTag — never the
  //                            full UID (matches `scan-login.ts:293`).
  // ===========================================================================
  | "device.registered"
  | "device.deregistered"
  | "device.scan.armed"
  | "device.scan.completed"
  | "device.scan.released"
  | "device.token.issued"
  | "device.token.revoked"
  | "device.token.invalid";

export interface AuthEventPayload {
  /** Optional user reference (set on success; omit on failed-pre-resolve flows). */
  userId?: string | null;
  /** Plaintext email — gets sha256-hashed before storage. */
  email?: string | null;
  /** Pre-hashed email; pass when only the hash is known (e.g. magic-link replay). */
  emailHash?: string | null;
  ip?: string | null;
  ua?: string | null;
  route?: string | null;
  /** Free-form context, JSONB-serialized. */
  metadata?: Record<string, unknown> | null;
}

/** sha256(LOWER(email)) — used as the identifier in audit tables. */
export async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Write a single row to `auth_audit`. Errors are logged, never rethrown. */
export async function logAuthEvent(
  event: AuthAuditEvent,
  payload: AuthEventPayload = {},
): Promise<void> {
  try {
    let emailHash: string | null = payload.emailHash ?? null;
    if (!emailHash && payload.email) {
      emailHash = await hashEmail(payload.email);
    }
    const row: NewAuthAudit = {
      event,
      userId: payload.userId ?? null,
      emailHash,
      ip: payload.ip ?? null,
      ua: payload.ua ?? null,
      route: payload.route ?? null,
      metadata:
        (payload.metadata ?? null) as unknown as NewAuthAudit["metadata"],
    };
    await db.insert(authAudit).values(row);
  } catch (err) {
    // Audit failures must NEVER break auth flows. Log loudly; ops can
    // investigate via the underlying error stream.
    console.error("[auth-audit] insert failed", { event, err });
  }
}

// =============================================================================
// Convenience wrappers — preferred call sites. Keep the shape narrow so each
// call site reads as `await logScanLoginSuccess({ userId, ip })` etc.
// =============================================================================

export const logMagicLinkRequested = (p: AuthEventPayload) =>
  logAuthEvent("magic_link.requested", p);
export const logMagicLinkConsumed = (p: AuthEventPayload) =>
  logAuthEvent("magic_link.consumed", p);
export const logMagicLinkFailed = (p: AuthEventPayload) =>
  logAuthEvent("magic_link.failed", p);
export const logScanLoginSuccess = (p: AuthEventPayload) =>
  logAuthEvent("scan.login_success", p);
export const logScanLoginFailed = (p: AuthEventPayload) =>
  logAuthEvent("scan.login_failed", p);
export const logPasswordLoginFailed = (p: AuthEventPayload) =>
  logAuthEvent("password.login_failed", p);
export const logImpersonationStart = (p: AuthEventPayload) =>
  logAuthEvent("impersonation.start", p);
export const logImpersonationEnd = (p: AuthEventPayload) =>
  logAuthEvent("impersonation.end", p);
export const logImpersonationWriteBlocked = (p: AuthEventPayload) =>
  logAuthEvent("impersonation.write_blocked", p);
export const logCustomerAccountAutoProvisioned = (p: AuthEventPayload) =>
  logAuthEvent("customer.account.auto_provisioned", p);
export const logCapabilityDenied = (p: AuthEventPayload) =>
  logAuthEvent("capability.denied", p);
export const logCustomerAccountAutoCreateBlockedAdminEmail = (
  p: AuthEventPayload,
) => logAuthEvent("customer.account.auto_create_blocked_admin_email", p);

/**
 * Log a customer-initiated mutation (scan-start, session-stop, reserve, etc.).
 *
 * Stored as `event='customer.action'` with the concrete verb in
 * `metadata.action` — single audit-event identifier keeps log scrapers
 * straightforward; the action label gives forensic granularity.
 *
 * Common actions: `scan-start`, `session-stop`, `reservation-create`,
 * `reservation-cancel`, `reservation-reschedule`, `onboarded`,
 * `profile-update`.
 */
export interface CustomerActionPayload extends AuthEventPayload {
  /** Free-form action label; e.g. "scan-start", "session-stop". */
  action: string;
}

export async function logCustomerAction(
  payload: CustomerActionPayload,
): Promise<void> {
  await logAuthEvent("customer.action", {
    ...payload,
    metadata: {
      ...(payload.metadata ?? {}),
      action: payload.action,
    },
  });
}

// =============================================================================
// ExpresScan / Wave 1 Track A — device audit convenience wrappers.
//
// Thin shims so call sites read as `await logDeviceRegistered({ ... })`. Each
// wrapper just forwards to `logAuthEvent` with the event identifier wired in.
// See `expresscan/docs/plan/60-security.md` §12 for the payload conventions.
// =============================================================================

export const logDeviceRegistered = (p: AuthEventPayload) =>
  logAuthEvent("device.registered", p);
export const logDeviceDeregistered = (p: AuthEventPayload) =>
  logAuthEvent("device.deregistered", p);
export const logDeviceScanArmed = (p: AuthEventPayload) =>
  logAuthEvent("device.scan.armed", p);
export const logDeviceScanCompleted = (p: AuthEventPayload) =>
  logAuthEvent("device.scan.completed", p);
export const logDeviceScanReleased = (p: AuthEventPayload) =>
  logAuthEvent("device.scan.released", p);
export const logDeviceTokenIssued = (p: AuthEventPayload) =>
  logAuthEvent("device.token.issued", p);
export const logDeviceTokenRevoked = (p: AuthEventPayload) =>
  logAuthEvent("device.token.revoked", p);
export const logDeviceTokenInvalid = (p: AuthEventPayload) =>
  logAuthEvent("device.token.invalid", p);
