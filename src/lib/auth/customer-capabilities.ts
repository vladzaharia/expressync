/**
 * Capability defaults for customer-flow device registration.
 *
 * Customer-flow device registration always assigns the `user` capability
 * only. Admins add `.scanner` later via the admin web UI. Do not parameterize
 * this — the rule is intentional.
 *
 * Any new customer-facing endpoint that creates a `devices` row on behalf of
 * a customer (QR sign-in, magic-link verify, future tap-to-login, ...) MUST
 * call this helper rather than passing a literal capability list. Centralising
 * this here is the only way to guarantee no future endpoint ever mints a
 * customer device with `.scanner` / `.kiosk` / `.charger` capabilities.
 */
export const customerCapabilityDefaults = (): readonly ["user"] =>
  ["user"] as const;
