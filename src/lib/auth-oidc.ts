/**
 * ExpresScan / Wave 1 Track A — Pocket ID OIDC plugin for BetterAuth.
 *
 * Adds a generic-OIDC provider so admins can sign in with Pocket ID
 * instead of email/password. Email/password stays loaded unconditionally
 * as a break-glass; this plugin is only added to BetterAuth's plugin
 * list when `ADMIN_OIDC_ISSUER` is non-empty (`makeAdminOidcPlugin()`
 * returns null otherwise).
 *
 * Authorization model: who is allowed to authenticate against this
 * surface is gated entirely IdP-side — Pocket ID's per-client allow-list
 * is the source of truth. If the IdP authenticates the user, we treat
 * them as an admin. JIT runs once on first OIDC login; subsequent logins
 * reuse the existing user row. Admin-removal is a deliberate workflow at
 * the IdP (revoke client access there); we never demote in app code.
 */

import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { config } from "./config.ts";

/**
 * Build the BetterAuth generic-OIDC plugin against the configured
 * Pocket ID issuer. Returns `null` when `ADMIN_OIDC_ISSUER` is not set
 * — in that case the caller should leave the plugin off entirely (the
 * absence of OIDC is the documented dev-default, not an error).
 */
export function makeAdminOidcPlugin(): ReturnType<typeof genericOAuth> | null {
  if (!config.ADMIN_OIDC_ISSUER || !config.ADMIN_OIDC_CLIENT_ID) {
    return null;
  }

  // Pocket ID exposes the standard OIDC discovery doc at the issuer's
  // `.well-known/openid-configuration`. Letting BetterAuth fetch it on
  // first request keeps the plugin definition compact.
  const discoveryUrl = `${
    config.ADMIN_OIDC_ISSUER.replace(/\/+$/, "")
  }/.well-known/openid-configuration`;

  return genericOAuth({
    config: [
      {
        providerId: "pocket-id",
        discoveryUrl,
        clientId: config.ADMIN_OIDC_CLIENT_ID,
        clientSecret: config.ADMIN_OIDC_CLIENT_SECRET || undefined,
        // OIDC core scopes — no `groups` because we no longer gate on
        // it; the IdP's per-client allow-list is authoritative.
        scopes: ["openid", "profile", "email"],
        // PKCE is recommended by the security audit even for confidential
        // clients — Pocket ID supports it.
        pkce: true,
        // Force a fresh login per session (admins shouldn't reuse a
        // long-lived IdP session against a privileged surface).
        prompt: "login",
        /**
         * JIT provisioning hook. The IdP has already authorised the user
         * (Pocket ID enforces its per-client allow-list before issuing
         * tokens), so any successful callback is by definition an admin
         * for this surface. Stamp `role='admin'` and mirror the standard
         * OIDC profile fields onto the BetterAuth user row.
         */
        mapProfileToUser: (profile: Record<string, unknown>) => {
          const email = typeof profile.email === "string"
            ? profile.email
            : null;
          const name = typeof profile.name === "string"
            ? profile.name
            : (typeof profile.preferred_username === "string"
              ? profile.preferred_username
              : null);
          return {
            email: email ?? undefined,
            name: name ?? undefined,
            // BetterAuth's User type accepts arbitrary extra props; the
            // database adapter writes them to the matching column. Our
            // schema has `role` on the users table.
            role: "admin",
          } as Partial<{
            email: string;
            name: string;
            role: string;
          }>;
        },
      },
    ],
  });
}

/** True when the OIDC provider is configured and the plugin should load. */
export function isAdminOidcEnabled(): boolean {
  return Boolean(
    config.ADMIN_OIDC_ISSUER && config.ADMIN_OIDC_CLIENT_ID,
  );
}
