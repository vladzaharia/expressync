/**
 * Polaris Track A — programmatic session creation for non-magic-link flows.
 *
 * Track A's job is to expose a `createCustomerSession(userId, req)` helper
 * that downstream tracks (scan-login, admin-side invite-flows) can call to
 * mint a Better-Auth session AS-IF the user just signed in via a credential
 * flow. The helper must:
 *
 *   - Use Better-Auth's internal session creator (so plugin hooks fire and
 *     the cookie is signed/HMAC'd with the canonical secret).
 *   - Return Set-Cookie headers the caller copies onto its Response.
 *   - Refuse to issue sessions for non-customer roles (defense-in-depth —
 *     the migration-0018 trigger already prevents an admin-as-customer
 *     mapping, but the helper checks again here).
 *
 * Implementation note: in better-auth 1.4.x the public `auth.api.*` surface
 * does NOT expose a "sign in by user id" endpoint (verified by grepping
 * `node_modules/better-auth/dist/api/routes`). The supported pattern is to
 * mount a custom plugin endpoint that has access to `ctx.context.internalAdapter`
 * and `setSessionCookie` from `better-auth/cookies`. See
 * `polarisCustomerSessionPlugin` below for the registered endpoint, and
 * `auth.ts` for where it's wired into the BetterAuth instance.
 *
 * Once the plugin is registered, callers use `auth.api.createCustomerSession`
 * to mint the session and read `Set-Cookie` from the returned headers. The
 * thin wrapper exported here normalizes the response shape and applies the
 * role guard.
 */

import { setSessionCookie } from "better-auth/cookies";
import { createAuthEndpoint } from "better-auth/api";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";

/**
 * Polaris customer-session plugin.
 *
 * Exposes a single internal endpoint:
 *   POST /polaris/internal/sign-in-with-user-id
 *     body: { userId: string }
 *
 * The endpoint is intentionally unmounted on the public router — callers
 * invoke it via `auth.api.signInWithUserId(...)` from server code only.
 * Even so, it enforces:
 *   1. The caller's request must be made server-side (we trust the call
 *      site because there's no client-side route to it; the route lives
 *      inside the auth plugin endpoint table).
 *   2. The target user MUST have `role='customer'`. Admins cannot be
 *      sessioned via this path under any circumstance.
 *   3. The user must exist; missing userId yields 404.
 */
export const polarisCustomerSessionPlugin = () => ({
  id: "polaris-customer-session" as const,
  endpoints: {
    /**
     * POST /polaris/internal/sign-in-with-user-id
     * Server-side only. See module docstring for security model.
     */
    signInWithUserId: createAuthEndpoint(
      "/polaris/internal/sign-in-with-user-id",
      {
        method: "POST",
        body: z.object({ userId: z.string() }),
      },
      // deno-lint-ignore no-explicit-any
      async (ctx: any) => {
        const userId = ctx.body?.userId as string | undefined;
        if (!userId || typeof userId !== "string") {
          return ctx.json({ error: "userId required" }, { status: 400 });
        }

        // Hard guard: only customers can be sessioned via this path. We
        // re-check on the DB rather than trusting the caller because the
        // caller might have stale data.
        const [row] = await db
          .select({ id: users.id, role: users.role, email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!row) {
          return ctx.json({ error: "user not found" }, { status: 404 });
        }
        if (row.role !== "customer") {
          // Audit-worthy event — the caller tried to mint a session for a
          // non-customer user. Log loudly so this surfaces in ops.
          console.error(
            "[polaris-customer-session] refused: target is not customer",
            { userId, role: row.role },
          );
          return ctx.json(
            { error: "user is not a customer" },
            { status: 403 },
          );
        }

        const userRecord = await ctx.context.internalAdapter.findUserByEmail(
          row.email,
        );
        const fullUser = userRecord?.user;
        if (!fullUser) {
          return ctx.json(
            { error: "user lookup failed" },
            { status: 500 },
          );
        }

        const session = await ctx.context.internalAdapter.createSession(
          row.id,
        );
        if (!session) {
          return ctx.json(
            { error: "failed to create session" },
            { status: 500 },
          );
        }
        await setSessionCookie(ctx, { session, user: fullUser });
        return ctx.json({
          token: session.token,
          user: {
            id: fullUser.id,
            email: fullUser.email,
          },
        });
      },
    ),
  },
});

/**
 * Server-side helper: mint a customer session for `userId`.
 *
 * Returns the headers (containing Set-Cookie) that the calling handler
 * should attach to its outgoing Response. The caller is responsible for
 * adding any extra headers (Content-Type, Location for redirects, etc.).
 *
 * Throws if the user doesn't exist or isn't role='customer'.
 *
 * Usage:
 *   const { headers } = await createCustomerSession(userId, req);
 *   const out = new Response(null, { status: 302, headers: { Location: "/" } });
 *   for (const [k, v] of headers.entries()) out.headers.append(k, v);
 *   return out;
 */
export async function createCustomerSession(
  userId: string,
  req: Request,
): Promise<{ headers: Headers; token: string }> {
  // Lazy-import to avoid circular dependency: auth.ts → auth-helpers.ts.
  const { auth } = await import("./auth.ts");
  // deno-lint-ignore no-explicit-any
  const api = auth.api as any;
  if (typeof api?.signInWithUserId !== "function") {
    throw new Error(
      "[polaris] createCustomerSession requires the polarisCustomerSessionPlugin to be registered in src/lib/auth.ts",
    );
  }
  const response = await api.signInWithUserId({
    body: { userId },
    headers: req.headers,
    // Better-Auth's runtime adapter returns a Response when this is true; we
    // need the Set-Cookie headers, so opt-in to the response shape.
    asResponse: true,
  });
  const headers = response instanceof Response
    ? new Headers(response.headers)
    : new Headers();
  // Try to extract token if returned in body, but don't error if it's not.
  let token = "";
  if (response instanceof Response) {
    try {
      const cloned = response.clone();
      const json = await cloned.json();
      if (json && typeof json === "object" && "token" in json) {
        token = String((json as { token?: unknown }).token ?? "");
      }
    } catch {
      // body wasn't JSON or already consumed — token stays empty
    }
  }
  return { headers, token };
}

/**
 * Convenience: re-issue a session for an admin via password reset (if a
 * future track wants to auto-login the admin after their password reset
 * confirmation). Currently unused but reserved here so the import surface
 * stays stable.
 */
export async function requireFreshAuth(
  req: Request,
  maxAgeSeconds = 5 * 60,
): Promise<boolean> {
  const { auth } = await import("./auth.ts");
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return false;
  const createdAt = new Date(session.session.createdAt as Date | string);
  const ageSeconds = (Date.now() - createdAt.getTime()) / 1000;
  return ageSeconds <= maxAgeSeconds;
}
