/**
 * Browser-side Better Auth client.
 *
 * Exposes the typed RPC surface (`authClient.multiSession.*`,
 * `authClient.signOut`, `authClient.getSession`, …) backed by the same
 * `/api/auth/*` endpoints the server mounts in `auth.ts`. Used by islands
 * that need to read or mutate auth state from the browser.
 *
 * Plugins listed here mirror the server-side plugins that have a client
 * counterpart. Server-only plugins (magic-link, generic-oauth, our custom
 * polaris-customer-session) don't need a client entry — the browser hits
 * their endpoints by URL when relevant (e.g. magic-link preflight).
 */
import { createAuthClient } from "better-auth/client";
import { multiSessionClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [multiSessionClient()],
});

/** Convenience wrappers preserved for older call sites. */
export const signOut = () => authClient.signOut();
export const getSession = () => authClient.getSession();
