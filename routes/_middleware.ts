/**
 * Polaris Track A — root middleware.
 *
 * Runs on every request after the hostname dispatch + path rewrite in
 * `main.ts`. Responsibilities (in order):
 *
 *   1. Surface classification — derive `ctx.state.surface` from the host.
 *      Reject unknown hosts with 404 (defense vs Host-header smuggling).
 *   2. Composite rate limiting — IP + path family, with stricter bands for
 *      auth / scan / magic-link endpoints.
 *   3. Route classification — table-driven (`route-classifier.ts`).
 *   4. Public-route bypass — login pages, /api/auth, /api/health, etc.
 *   5. Session resolution — `auth.api.getSession` against the shared cookie.
 *   6. 8-hour customer TTL ceiling — revoke + redirect on expired customer
 *      sessions (admins keep the 7-day session).
 *   7. Surface-vs-role enforcement — admin host requires role=admin;
 *      customer host accepts any logged-in user; impersonation via `?as=`.
 *   8. API endpoint surface gating — `/api/admin/*` only on admin host;
 *      `/api/customer/*` only on customer host.
 *   9. Origin-header check on state-changing methods (`assertSameOrigin`).
 *  10. Security headers (X-Content-Type-Options, X-Frame-Options, HSTS).
 *
 * Steps 1–4 are SYNC; steps 5–10 are async per request.
 */

import { auth } from "../src/lib/auth.ts";
import { db } from "../src/db/index.ts";
import {
  impersonationAudit,
  sessions as sessionsTable,
  users,
} from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { define } from "../utils.ts";
import { checkRateLimit } from "../src/lib/utils/rate-limit.ts";
import { classifySurface } from "../src/lib/hostname-dispatch.ts";
import { classifyRoute } from "../src/lib/route-classifier.ts";
import { config } from "../src/lib/config.ts";
import {
  assertSameOrigin,
  OriginMismatchError,
  originMismatchResponse,
} from "../src/lib/origin.ts";
import { logAuthEvent, logImpersonationStart } from "../src/lib/audit.ts";

// Rate-limit ceilings.
const RATE_LIMIT_GENERAL_MAX = 100;
const RATE_LIMIT_AUTH_MAX = 10;
const RATE_LIMIT_MAGIC_LINK_PREFLIGHT_MAX = 20; // per IP, per minute
const RATE_LIMIT_SCAN_LOGIN_PER_IP_MAX = 10; // per minute
// Reserved for forthcoming SSE concurrency cap (Track C — scan-detect).
const _RATE_LIMIT_SCAN_DETECT_CONCURRENT_PER_IP = 3;

/**
 * Get client IP address from request. Honor proxy headers (Traefik /
 * Cloudflare) but fall back to "unknown" — Postgres rate-limiter is keyed
 * by string and "unknown" still buckets, just imperfectly.
 */
function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

/** Build a 404 Response — preferred over 403 for ownership/role mismatches. */
function notFoundResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Not Found" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

/** Build a 401 Response for unauthenticated API calls. */
function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/** Build a 302 Response to the surface-appropriate login.
 *
 * Both surfaces use `/login` as their public sign-in URL. The path-rewrite
 * in `main.ts` translates the admin URL to `routes/admin/login.tsx`; the
 * customer URL serves directly from `routes/login.tsx`. The `_surface`
 * parameter is kept on the signature for forwards compat in case the
 * paths diverge (e.g. admin-side moves to `/admin/login` exposed in URL).
 */
function redirectToLogin(_surface: "admin" | "customer"): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: "/login" },
  });
}

/** Build a 429 Too Many Requests Response. */
function rateLimitedResponse(retryAfterSeconds = 60): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

/**
 * Content-Security-Policy — REPORT-ONLY for now.
 *
 * We're intentionally not enforcing yet because the theme bootstrap in
 * `routes/_app.tsx` is an inline <script>, and Fresh's island serializer
 * also emits inline JSON state blobs. Once those are migrated to nonced
 * external modules we can drop `'unsafe-inline'` from `script-src` and
 * promote this to `Content-Security-Policy` (enforcing).
 *
 *  - default-src 'self'                — same-origin by default.
 *  - script-src + 'unsafe-inline'      — temporary; tracking removal.
 *  - script-src + 'unsafe-eval'        — required by some Vite/HMR paths.
 *  - style-src + 'unsafe-inline'       — Tailwind's runtime style is fine,
 *                                         but a few islands still inject.
 *  - img-src ... assets.polaris.express— marketing/asset CDN host.
 *  - frame-ancestors 'none'            — matches X-Frame-Options: DENY.
 *  - base-uri / form-action 'self'     — defense vs <base> hijack and
 *                                         cross-origin form posts.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://assets.polaris.express",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Apply standard security headers + HSTS to a Response. */
function applySecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains",
  );
  // Report-only initially — we'll promote to enforcing once the inline
  // theme bootstrap in _app.tsx is migrated and `'unsafe-inline'` can be
  // dropped from script-src.
  response.headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
  return response;
}

/**
 * Per-request rate limiter — applies up to three composite buckets:
 *   - general:{ip}        — coarse anti-flood (100/min default)
 *   - auth:{ip}           — stricter for /api/auth/* (10/min)
 *   - mlpreflight:{ip}    — magic-link preflight (20/min)
 *   - scanlogin:{ip}      — scan-login attempts (10/min)
 *
 * Returns `true` when allowed, `false` when blocked. The middleware uses
 * the boolean to decide whether to short-circuit with 429.
 */
async function applyRateLimits(
  pathname: string,
  ip: string,
): Promise<boolean> {
  // Service-to-service paths bypass rate-limiting entirely. /api/ocpp is
  // SteVe → ExpresSync hook traffic (HMAC-signed; abuse is bounded by
  // the auth gate, not by IP). A busy charging hour can easily push
  // past 100 calls/min from a single SteVe instance.
  if (pathname.startsWith("/api/ocpp")) {
    return true;
  }

  // Always check the coarse bucket first (cheapest disqualification).
  if (!await checkRateLimit(`general:${ip}`, RATE_LIMIT_GENERAL_MAX)) {
    return false;
  }
  if (
    pathname.startsWith("/api/auth") &&
    !await checkRateLimit(`auth:${ip}`, RATE_LIMIT_AUTH_MAX)
  ) {
    return false;
  }
  if (
    pathname.startsWith("/api/auth/magic-link/preflight") &&
    !await checkRateLimit(
      `mlpreflight:${ip}`,
      RATE_LIMIT_MAGIC_LINK_PREFLIGHT_MAX,
    )
  ) {
    return false;
  }
  if (
    pathname.startsWith("/api/auth/scan-login") &&
    !await checkRateLimit(`scanlogin:${ip}`, RATE_LIMIT_SCAN_LOGIN_PER_IP_MAX)
  ) {
    return false;
  }
  return true;
}

/**
 * Polaris Track A — root middleware.
 *
 * See module docstring for the full step-by-step.
 */
export const handler = define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const clientIp = getClientIp(ctx.req);
  const method = ctx.req.method.toUpperCase();

  // 1. Surface classification.
  const surface = classifySurface(hostname);
  if (!surface) {
    // Unknown host — return 404 to avoid leaking the existence of the
    // service via Host header probes.
    return applySecurityHeaders(notFoundResponse());
  }
  ctx.state.surface = surface;

  // 2. Composite rate limiting.
  if (!await applyRateLimits(pathname, clientIp)) {
    return applySecurityHeaders(rateLimitedResponse());
  }

  // 3. Route classification.
  const classification = classifyRoute(pathname, surface);

  // 4. Public-route bypass — no session required.
  if (classification === "PUBLIC") {
    const response = await ctx.next();
    return applySecurityHeaders(response);
  }

  // 5. API surface gating — reject cross-surface API calls early so the
  // 401/302 we issue below don't accidentally expose route existence.
  if (
    pathname.startsWith("/api/admin/") && surface !== "admin"
  ) {
    return applySecurityHeaders(notFoundResponse());
  }
  if (
    pathname.startsWith("/api/customer/") && surface !== "customer"
  ) {
    return applySecurityHeaders(notFoundResponse());
  }

  // 6. Session resolution.
  const session = await auth.api.getSession({ headers: ctx.req.headers });
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(unauthorizedResponse());
    }
    return applySecurityHeaders(redirectToLogin(surface));
  }

  // Look up the user's role from the database (BetterAuth doesn't know
  // about our custom role column).
  const [dbUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const userRole = dbUser?.role ?? "customer";
  ctx.state.user = { ...session.user, role: userRole };
  ctx.state.session = session.session;

  // 7. Customer 8-hour TTL ceiling — admins keep the 7-day session.
  if (userRole === "customer") {
    const createdAt = session.session.createdAt instanceof Date
      ? session.session.createdAt
      : new Date(session.session.createdAt as unknown as string);
    const ageSeconds = (Date.now() - createdAt.getTime()) / 1000;
    if (ageSeconds > config.CUSTOMER_SESSION_TTL_SECONDS) {
      // Revoke + redirect. The DB delete is best-effort (failures don't
      // change the outcome — we still send the 302 so the user re-logs in).
      try {
        await db.delete(sessionsTable).where(
          eq(sessionsTable.id, session.session.id as string),
        );
      } catch (err) {
        console.error("[middleware] failed to revoke expired session", err);
      }
      await logAuthEvent("session.expired_customer_ttl", {
        userId: session.user.id,
        ip: clientIp,
        ua: ctx.req.headers.get("user-agent"),
        route: pathname,
      });
      if (pathname.startsWith("/api/")) {
        return applySecurityHeaders(unauthorizedResponse());
      }
      return applySecurityHeaders(redirectToLogin(surface));
    }
  }

  // 8. Surface-vs-role enforcement.
  if (surface === "admin") {
    // Admin host is admin-only. A logged-in customer who lands here gets
    // bounced to the customer surface (their cookie is shared, so the
    // customer host will recognize them).
    if (userRole !== "admin") {
      if (pathname.startsWith("/api/")) {
        return applySecurityHeaders(notFoundResponse());
      }
      return applySecurityHeaders(
        new Response(null, {
          status: 302,
          headers: { Location: "https://polaris.express/" },
        }),
      );
    }
  } else {
    // Customer surface — enforce classification.
    if (classification === "ADMIN_ONLY") {
      // ADMIN_ONLY paths on the customer surface are 404'd (e.g. trying
      // to load /api/admin/sync from polaris.express).
      return applySecurityHeaders(notFoundResponse());
    }
    if (classification === "UNKNOWN") {
      // Unknown route on customer surface — deny by default.
      return applySecurityHeaders(notFoundResponse());
    }
    if (classification === "CUSTOMER_ONLY") {
      // CUSTOMER_ONLY surfaces accept admins under impersonation only;
      // bare admins seeing the customer dashboard see empty data.
      // Either way we let them through — scoping at the handler level
      // returns zero rows for admins without customer mappings.
    }

    // 9. Impersonation handling — `?as=<customerUserId>` is admin-only.
    const asParam = url.searchParams.get("as");
    if (asParam) {
      if (userRole !== "admin") {
        // Non-admins trying to use ?as= are silently ignored (don't error
        // — the URL might just be a bookmark from when they were admin).
      } else {
        const [target] = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.id, asParam))
          .limit(1);
        if (target?.role === "customer") {
          ctx.state.actingAs = target.id;
          // Audit the impersonation. Best-effort + per-route rate-limit
          // so we don't bloat the table on chatty endpoints.
          const auditKey = `imp_log:${session.user.id}:${pathname}`;
          const shouldLog = await checkRateLimit(auditKey, 1);
          if (shouldLog) {
            try {
              await db.insert(impersonationAudit).values({
                adminUserId: session.user.id,
                customerUserId: target.id,
                route: pathname,
                method,
              });
              await logImpersonationStart({
                userId: session.user.id,
                route: pathname,
                metadata: { customerUserId: target.id, method },
              });
            } catch (err) {
              console.error("[middleware] impersonation audit failed", err);
            }
          }
        }
      }
    }
  }

  // 10. Origin-header check on state-changing methods.
  if (
    method === "POST" || method === "PUT" || method === "PATCH" ||
    method === "DELETE"
  ) {
    try {
      assertSameOrigin(ctx);
    } catch (err) {
      if (err instanceof OriginMismatchError) {
        await logAuthEvent("privilege_violation", {
          userId: ctx.state.user?.id,
          ip: clientIp,
          ua: ctx.req.headers.get("user-agent"),
          route: pathname,
          metadata: { reason: "origin_mismatch", method },
        });
        return applySecurityHeaders(originMismatchResponse());
      }
      throw err;
    }
  }

  const response = await ctx.next();
  return applySecurityHeaders(response);
});
