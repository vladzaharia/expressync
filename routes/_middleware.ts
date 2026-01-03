import { FreshContext } from "fresh";
import { auth } from "../src/lib/auth.ts";
import { define } from "../utils.ts";

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  "/login",
  "/api/auth",
  "/api/health",
];

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // per window
const AUTH_RATE_LIMIT_MAX = 10; // stricter for auth endpoints

// Simple in-memory rate limiter (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Get client IP address from request
 */
function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
}

/**
 * Check rate limit for a given key
 */
function checkRateLimit(key: string, maxRequests: number): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  // Cleanup expired entries periodically to prevent memory leak
  if (rateLimitStore.size > 10000) {
    for (const [k, v] of rateLimitStore) {
      if (now > v.resetAt) rateLimitStore.delete(k);
    }
  }

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Check if path is public (no auth required)
 */
function isPublicPath(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => path.startsWith(route));
}

/**
 * Auth middleware
 *
 * Features:
 * - Rate limiting per IP address
 * - Stricter limits for auth endpoints (brute force protection)
 * - Session validation on protected routes
 * - Proper 401/302 responses based on route type
 */
export const handler = define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);
  const clientIp = getClientIp(ctx.req);

  // Rate limiting - stricter for auth endpoints
  const isAuthEndpoint = url.pathname.startsWith("/api/auth");
  const maxRequests = isAuthEndpoint
    ? AUTH_RATE_LIMIT_MAX
    : RATE_LIMIT_MAX_REQUESTS;

  const rateLimitKey = isAuthEndpoint
    ? `auth:${clientIp}`
    : `general:${clientIp}`;

  if (!checkRateLimit(rateLimitKey, maxRequests)) {
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

  // Allow public routes
  if (isPublicPath(url.pathname)) {
    return ctx.next();
  }

  // Allow static files
  if (
    url.pathname.startsWith("/_fresh") ||
    url.pathname.startsWith("/static")
  ) {
    return ctx.next();
  }

  // Check for valid session
  const session = await auth.api.getSession({
    headers: ctx.req.headers,
  });

  if (!session) {
    // API routes should return 401
    if (url.pathname.startsWith("/api/")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Pages should redirect to login
    return new Response(null, {
      status: 302,
      headers: { Location: "/login" },
    });
  }

  // Add user to state for routes to access
  ctx.state.user = session.user;
  ctx.state.session = session.session;

  return ctx.next();
});

