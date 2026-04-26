/**
 * Polaris Track A — declarative route classification.
 *
 * Single source of truth for "who can access what URL". Every URL prefix
 * the app serves MUST resolve to exactly one classification:
 *
 *   PUBLIC        — accessible without a session (login, health, webhooks)
 *   SHARED        — accessible to any authenticated user (admin or customer)
 *   CUSTOMER_ONLY — requires `role='customer'` (or admin under impersonation)
 *   ADMIN_ONLY    — requires `role='admin'` (no impersonation bypass)
 *
 * Middleware (`routes/_middleware.ts`) consults this classifier as the FIRST
 * step after hostname dispatch + path rewrite (the rewrite happens in
 * `main.ts` so by the time middleware runs, admin URLs have a `/admin/`
 * prefix — see `src/lib/hostname-dispatch.ts`).
 *
 * Adding a new route without a classification forces `classifyRoute()` to
 * return UNKNOWN, which the middleware treats as ADMIN_ONLY (deny by
 * default — the safest fallback).
 *
 * IMPORTANT: classification operates on the FILE-SYSTEM URL — i.e. AFTER
 * the admin path rewrite has been applied. So admin URLs in this table
 * include the `/admin/` prefix even though browsers see them without it.
 */

export type RouteClassification =
  | "PUBLIC"
  | "SHARED"
  | "CUSTOMER_ONLY"
  | "ADMIN_ONLY"
  | "UNKNOWN";

interface RouteRule {
  /** URL prefix (file-system path; post-rewrite for admin). Match is `pathname === prefix || pathname.startsWith(prefix + "/")`. */
  prefix: string;
  classification: RouteClassification;
  /** Optional surface restriction — if set, the rule only applies on this surface. */
  surface?: "admin" | "customer";
}

// Order is irrelevant: `classifyRoute()` sorts by prefix length so the
// longest match wins regardless of declaration order.
const RULES: readonly RouteRule[] = [
  // ------- PUBLIC (both surfaces) -------
  { prefix: "/api/auth", classification: "PUBLIC" },
  { prefix: "/api/health", classification: "PUBLIC" },
  { prefix: "/api/webhook/lago", classification: "PUBLIC" },
  // SteVe pre-authorize hook — internal service-to-service call from the
  // SteVe fork's HttpPreAuthorizeHook. HMAC-signed; no session.
  { prefix: "/api/ocpp", classification: "PUBLIC" },
  // ExpresScan device-registration entry point. Authenticated by the
  // PKCE (oneTimeCode, codeVerifier) tuple at the handler level — the
  // iOS app's URLSession cannot carry the admin cookie that minted the
  // code (ASWebAuthenticationSession sandboxes its own cookie jar) and
  // doesn't send an Origin header. The PKCE claim itself proves which
  // admin the device should be owned by. See `routes/api/devices/register.ts`
  // step 3 (`claimOneTimeCode`).
  { prefix: "/api/devices/register", classification: "PUBLIC" },

  // ------- PUBLIC (admin surface only) -------
  // Admin URLs are file-system rewritten to /admin/X, so the public admin
  // login page appears as `/admin/login` in `ctx.url.pathname`. The
  // `/admin/login/email` fallback (Wave 1 Track A — only reachable when
  // ADMIN_AUTH_SHOW_FALLBACK=true) is also public so unauthenticated
  // admins can reach the email/password form without a session.
  { prefix: "/admin/login", classification: "PUBLIC", surface: "admin" },
  {
    prefix: "/admin/reset-password",
    classification: "PUBLIC",
    surface: "admin",
  },
  {
    prefix: "/api/admin/forgot-password",
    classification: "PUBLIC",
    surface: "admin",
  },
  {
    prefix: "/api/admin/reset-password",
    classification: "PUBLIC",
    surface: "admin",
  },

  // ------- PUBLIC (customer surface only) -------
  { prefix: "/login", classification: "PUBLIC", surface: "customer" },
  { prefix: "/auth/verify", classification: "PUBLIC", surface: "customer" },
  { prefix: "/auth/scan", classification: "PUBLIC", surface: "customer" },

  // ------- ADMIN_ONLY -------
  // Admin pages live at /admin/* in the file system (post-rewrite).
  { prefix: "/admin", classification: "ADMIN_ONLY", surface: "admin" },
  // Admin API endpoints — only mounted on the admin surface.
  { prefix: "/api/admin", classification: "ADMIN_ONLY", surface: "admin" },

  // ------- CUSTOMER_ONLY -------
  // Customer pages live at the root on the customer surface.
  { prefix: "/sessions", classification: "CUSTOMER_ONLY", surface: "customer" },
  {
    prefix: "/reservations",
    classification: "CUSTOMER_ONLY",
    surface: "customer",
  },
  { prefix: "/cards", classification: "CUSTOMER_ONLY", surface: "customer" },
  { prefix: "/billing", classification: "CUSTOMER_ONLY", surface: "customer" },
  { prefix: "/account", classification: "CUSTOMER_ONLY", surface: "customer" },
  // Customer API endpoints — only mounted on the customer surface.
  {
    prefix: "/api/customer",
    classification: "CUSTOMER_ONLY",
    surface: "customer",
  },
  /// Customer SSE endpoint
  {
    prefix: "/api/stream/customer",
    classification: "CUSTOMER_ONLY",
    surface: "customer",
  },

  // ------- PUBLIC static / Fresh internals -------
  { prefix: "/_fresh", classification: "PUBLIC" },
  { prefix: "/static", classification: "PUBLIC" },
  { prefix: "/assets", classification: "PUBLIC" },
  // Apple Universal Links manifest. Apple's CDN validator
  // (`https://app-site-association.cdn-apple.com/a/v1/<host>`) fetches
  // `/.well-known/apple-app-site-association` (or `.json`) WITHOUT auth,
  // expecting `Content-Type: application/json` and no redirects. The
  // manifest must be PUBLIC so the validator can reach it.
  { prefix: "/.well-known", classification: "PUBLIC" },
  { prefix: "/favicon.ico", classification: "PUBLIC" },
  { prefix: "/favicon-16.png", classification: "PUBLIC" },
  { prefix: "/favicon-32.png", classification: "PUBLIC" },
  { prefix: "/favicon-48.png", classification: "PUBLIC" },
  { prefix: "/favicon-180.png", classification: "PUBLIC" },
  { prefix: "/favicon-192.png", classification: "PUBLIC" },
  { prefix: "/favicon-512.png", classification: "PUBLIC" },
  { prefix: "/polaris-favicon-16.png", classification: "PUBLIC" },
  { prefix: "/polaris-favicon-32.png", classification: "PUBLIC" },
  { prefix: "/polaris-favicon-48.png", classification: "PUBLIC" },
  { prefix: "/polaris-favicon-192.png", classification: "PUBLIC" },
  { prefix: "/polaris-favicon-512.png", classification: "PUBLIC" },
  { prefix: "/apple-touch-icon.png", classification: "PUBLIC" },
  { prefix: "/manifest.json", classification: "PUBLIC" },
  { prefix: "/manifest.admin.json", classification: "PUBLIC" },
  { prefix: "/robots.txt", classification: "PUBLIC" },

  // Root path. The customer dashboard is the canonical "/" on the customer
  // surface; the admin dashboard appears as "/admin" after rewrite.
  { prefix: "/", classification: "SHARED" },
];

/**
 * Classify a request by its (pathname, surface). Uses longest-prefix match
 * with surface awareness:
 *
 *   - Rules with no `surface` apply to all surfaces.
 *   - Surface-specific rules only apply when the surface matches.
 *
 * Returns `UNKNOWN` if no rule matches; the middleware should treat
 * UNKNOWN as ADMIN_ONLY (deny by default — the safest fallback).
 */
export function classifyRoute(
  pathname: string,
  surface: "admin" | "customer",
): RouteClassification {
  const candidates = RULES
    .filter((r) => !r.surface || r.surface === surface)
    .filter((r) => isPrefixMatch(pathname, r.prefix))
    // Longest prefix wins (ensures `/api/admin` beats `/`).
    .sort((a, b) => b.prefix.length - a.prefix.length);
  if (candidates.length === 0) return "UNKNOWN";
  return candidates[0].classification;
}

function isPrefixMatch(pathname: string, prefix: string): boolean {
  if (prefix === "/") {
    // Root only matches the literal root path; everything else falls through
    // to other rules. Without this guard, "/" would swallow every request.
    return pathname === "/";
  }
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Check whether a route is reachable without a session.
 * Convenience wrapper for the common middleware predicate.
 */
export function isPublicRoute(
  pathname: string,
  surface: "admin" | "customer",
): boolean {
  return classifyRoute(pathname, surface) === "PUBLIC";
}

/**
 * Diagnostic helper: list every rule (used by the middleware test fixture
 * to assert that adding a new rule doesn't accidentally collide with an
 * existing one).
 */
export function getAllRouteRules(): readonly RouteRule[] {
  return RULES;
}
