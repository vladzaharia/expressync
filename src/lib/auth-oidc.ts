/**
 * ExpresScan / Wave 1 Track A — Pocket ID OIDC plugin for BetterAuth.
 *
 * Adds a generic-OIDC provider so admins can sign in with Pocket ID
 * instead of email/password. Email/password stays loaded unconditionally
 * as a break-glass; this plugin is only added to BetterAuth's plugin
 * list when `ADMIN_OIDC_ISSUER` is non-empty (`makeAdminOidcPlugin()`
 * returns null otherwise).
 *
 * JIT provisioning model:
 *   - The OIDC provider's `mapProfileToUser` callback inspects the ID
 *     token's `groups` claim. If the claim contains
 *     `ADMIN_OIDC_ADMIN_GROUP`, we set `role='admin'` on the freshly-
 *     provisioned user. Otherwise we throw — non-admin OIDC logins are
 *     refused at the IdP path; the email/password path is unaffected.
 *   - JIT runs once on first OIDC login; subsequent logins reuse the
 *     existing user row. If their group membership later changes, this
 *     plugin does NOT re-evaluate — that's the IdP's job (revoke the
 *     session at the IdP and the next login picks up the new role).
 *
 * Why no automatic role demotion: BetterAuth's mapper runs at user-
 * creation time. Admin-removal is a deliberate workflow (audit trail,
 * communication), not an implicit consequence of an IdP claim flipping
 * during a session refresh.
 */

import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { config } from "./config.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child("AuthOidc");

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
        // OIDC core scopes + groups so we can read the `groups` claim.
        scopes: ["openid", "profile", "email", "groups"],
        // PKCE is recommended by the security audit even for confidential
        // clients — Pocket ID supports it.
        pkce: true,
        // Force a fresh login per session (admins shouldn't reuse a
        // long-lived IdP session against a privileged surface).
        prompt: "login",
        /**
         * JIT provisioning hook. Pocket ID returns the `groups` claim
         * (configurable per-OIDC-client at the IdP). We require that the
         * claim contains the configured admin group; absence means the
         * IdP user is not allowed to use this surface.
         *
         * Throwing here surfaces as a BetterAuth error to the OAuth
         * callback; the user sees the standard "auth failed" page. We
         * don't audit here because BetterAuth doesn't pass us request
         * context — the audit hook lives on the BetterAuth side.
         */
        mapProfileToUser: (profile: Record<string, unknown>) => {
          const groups = readStringArrayClaim(profile, "groups");
          const adminGroup = config.ADMIN_OIDC_ADMIN_GROUP;
          if (!adminGroup) {
            log.warn(
              "ADMIN_OIDC_ADMIN_GROUP unset — refusing OIDC login on closed config",
            );
            throw new Error("admin_oidc_group_unset");
          }
          if (!groups.includes(adminGroup)) {
            log.warn("OIDC login rejected — missing admin group claim", {
              sub: typeof profile.sub === "string" ? profile.sub : null,
              presented: groups,
              required: adminGroup,
            });
            throw new Error("admin_oidc_group_missing");
          }
          // Pocket ID profile shape uses standard OIDC fields. We mirror
          // them onto the BetterAuth user row + stamp role='admin'.
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

/**
 * Read a string-array claim out of an OIDC profile, accepting both
 * native arrays and comma-separated strings (some IdPs squash arrays to
 * scalars when there's a single value).
 */
function readStringArrayClaim(
  profile: Record<string, unknown>,
  key: string,
): string[] {
  const raw = profile[key];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [];
}

/** True when the OIDC provider is configured and the plugin should load. */
export function isAdminOidcEnabled(): boolean {
  return Boolean(
    config.ADMIN_OIDC_ISSUER && config.ADMIN_OIDC_CLIENT_ID,
  );
}
