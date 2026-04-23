/**
 * POST /api/auth/magic-link/preflight
 *
 * Polaris Track C — anti-enumeration + anti-shadow-account preflight.
 *
 * Body: { email: string }
 *
 * Behavior:
 *   1. Rate-limit composite (per IP, per email, per IP+email).
 *   2. Look up users by LOWER(email) = LOWER($1).
 *   3. Decision tree:
 *        - Not found        → 200 { status: "ok" }, no DB side effects.
 *        - role='customer'  → 200 { status: "ok" } AND fire signInMagicLink
 *                             through Better-Auth (which sends the email).
 *        - role='admin'     → 200 { status: "ok" }, NO email sent;
 *                             auth_audit row `magic_link.attempted_at_wrong_surface`.
 *
 * Always responds 200 with the same shape — admin-vs-customer is invisible
 * to the caller. This is the email-enumeration-safe wrapper around
 * Better-Auth's `/sign-in/magic-link` that the public login page uses.
 *
 * Security notes:
 *   - The actual /sign-in/magic-link Better-Auth endpoint stays mounted
 *     (catch-all in [...all].ts) so the standard Better-Auth client
 *     mechanics keep working. The expectation is that the customer
 *     login page uses THIS preflight, not the raw Better-Auth route.
 *   - Lookups are case-insensitive — invariant migration 0027 enforces
 *     LOWER(email) uniqueness, so this is guaranteed to be at most one
 *     row.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { users } from "../../../../src/db/schema.ts";
import { auth } from "../../../../src/lib/auth.ts";
import { checkRateLimit } from "../../../../src/lib/utils/rate-limit.ts";
import {
  hashEmail,
  logAuthEvent,
  logMagicLinkRequested,
} from "../../../../src/lib/audit.ts";
import {
  FEATURE_MAGIC_LINK,
  featureDisabledResponse,
} from "../../../../src/lib/feature-flags.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("MagicLinkPreflight");

const RATE_LIMIT_IP_MAX = 20;
const RATE_LIMIT_EMAIL_MAX = 5;
const RATE_LIMIT_IP_EMAIL_MAX = 3;

function uniformOk(): Response {
  return new Response(
    JSON.stringify({ status: "ok" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function badRequest(error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

function rateLimited(): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function isLikelyEmail(s: string): boolean {
  // Cheap structural check — Better-Auth does the strict validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const handler = define.handlers({
  async POST(ctx) {
    if (!FEATURE_MAGIC_LINK) {
      return featureDisabledResponse("magic-link");
    }

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return badRequest("invalid_json");
    }
    const emailRaw = (body as { email?: unknown }).email;
    if (typeof emailRaw !== "string") {
      return badRequest("email_required");
    }
    const email = emailRaw.trim().toLowerCase();
    if (email === "" || !isLikelyEmail(email)) {
      return badRequest("invalid_email");
    }

    const ip = getClientIp(ctx.req);

    // Composite rate limits — fail-open if any underlying check throws
    // (handled inside `checkRateLimit`).
    if (!await checkRateLimit(`mlpreflight:ip:${ip}`, RATE_LIMIT_IP_MAX)) {
      return rateLimited();
    }
    if (
      !await checkRateLimit(`mlpreflight:email:${email}`, RATE_LIMIT_EMAIL_MAX)
    ) {
      return rateLimited();
    }
    if (
      !await checkRateLimit(
        `mlpreflight:ip+email:${ip}:${email}`,
        RATE_LIMIT_IP_EMAIL_MAX,
      )
    ) {
      return rateLimited();
    }

    // Look up user by LOWER(email) — invariant 0027 enforces uniqueness.
    let row: { id: string; role: string; email: string | null } | undefined;
    try {
      const [found] = await db
        .select({
          id: users.id,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      row = found;
    } catch (err) {
      // Don't leak DB errors to the client; uniformly return ok and let
      // ops investigate via the log.
      log.error("user lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return uniformOk();
    }

    // Branch: not found → uniform ok, no side effects.
    if (!row) {
      return uniformOk();
    }

    // Branch: admin → uniform ok, NO email; audit only.
    if (row.role === "admin") {
      try {
        const eh = await hashEmail(email);
        await logAuthEvent("magic_link.attempted_at_wrong_surface", {
          userId: row.id,
          emailHash: eh,
          ip,
          ua: ctx.req.headers.get("user-agent"),
          route: "/api/auth/magic-link/preflight",
          metadata: { reason: "admin_email_at_customer_surface" },
        });
      } catch (err) {
        log.warn("failed to write admin-misuse audit", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return uniformOk();
    }

    // Branch: customer → fire the actual magic-link request via
    // Better-Auth. The plugin's `sendMagicLink` callback is wired to
    // `sendCustomerMagicLink` in src/lib/auth.ts.
    try {
      // deno-lint-ignore no-explicit-any
      const api = auth.api as any;
      if (typeof api?.signInMagicLink !== "function") {
        log.error(
          "Better-Auth signInMagicLink endpoint missing from auth.api",
        );
        // Still return ok — never leak internal misconfiguration to the
        // unauthenticated caller.
        return uniformOk();
      }
      // Use callbackURL = "/" so the post-verify landing redirects to the
      // customer dashboard.
      await api.signInMagicLink({
        body: { email, callbackURL: "/" },
        headers: ctx.req.headers,
      });
      // Best-effort additional audit (the plugin's `sendMagicLink`
      // callback already logs `magic_link.requested`; this duplicates
      // intentionally so the preflight call site is greppable).
      void logMagicLinkRequested({
        email,
        ip,
        ua: ctx.req.headers.get("user-agent"),
        route: "/api/auth/magic-link/preflight",
        metadata: { source: "preflight" },
      });
    } catch (err) {
      log.error("signInMagicLink threw", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Still return ok — uniformity is the security property.
    }

    return uniformOk();
  },
});
