import { auth } from "../src/lib/auth.ts";
import { db } from "../src/db/index.ts";
import { users } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { define } from "../utils.ts";
import { checkRateLimit } from "../src/lib/utils/rate-limit.ts";

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/webhook/lago",
];

// Routes that require admin role
const ADMIN_ONLY_PATHS = [
  "/api/sync",
  "/api/tag",
  "/api/dashboard",
  "/api/customer",
  "/api/subscription",
  "/api/user",
  "/api/charger",
  "/api/invoice",
  "/api/stream",
  "/api/usage",
  "/api/transaction",
  "/links",
  "/sync",
  "/users",
  "/chargers",
  "/transactions",
];

// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 100; // per window
const AUTH_RATE_LIMIT_MAX = 10; // stricter for auth endpoints

/**
 * Get client IP address from request
 */
function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
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

  // Look up the user's role from the database (BetterAuth doesn't know about our custom role column)
  const [dbUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const userRole = dbUser?.role ?? "customer";

  // Add user (with role) and session to state for routes to access
  ctx.state.user = { ...session.user, role: userRole };
  ctx.state.session = session.session;

  // Role-based access control: check if path requires admin role
  // "/" is checked as an exact match to avoid matching all paths as a prefix
  const isAdminOnlyPath = url.pathname === "/" ||
    ADMIN_ONLY_PATHS.some((prefix) => url.pathname.startsWith(prefix));

  if (isAdminOnlyPath && userRole !== "admin") {
    if (url.pathname.startsWith("/api/")) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Pages should return 403 for non-admin users
    return new Response(
      JSON.stringify({ error: "Forbidden: admin access required" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const response = await ctx.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
});
