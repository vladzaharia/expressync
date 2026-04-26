/**
 * Polaris Track A — hostname dispatch + path rewrite helpers.
 *
 * Centralized so `main.ts` (production) and `routes/_middleware.ts`
 * (per-request state) classify hostnames identically.
 *
 * Hostname → surface mapping:
 *   manage.polaris.express        → admin
 *   manage.polaris.localhost      → admin (dev)
 *   localhost / 127.0.0.1         → admin (dev fallback — single-host dev)
 *   polaris.express               → customer
 *   polaris.localhost             → customer (dev)
 *
 * The single-host dev fallback (`localhost`) maps to admin so the existing
 * dev workflow keeps working. Devs needing the customer surface set up a
 * /etc/hosts entry for `polaris.localhost`.
 */

export type Surface = "admin" | "customer";

const ADMIN_HOSTS = new Set<string>([
  "manage.polaris.express",
  "manage.polaris.localhost",
  // Dev/legacy fallback — keeps the existing single-host workflow alive
  // until devs explicitly opt into the dual-host setup.
  "localhost",
  "127.0.0.1",
]);

const CUSTOMER_HOSTS = new Set<string>([
  "polaris.express",
  "polaris.localhost",
]);

/** Classify a hostname as admin, or null if it's not an admin host. */
export function classifyAdminHostname(hostname: string): "admin" | null {
  return ADMIN_HOSTS.has(hostname) ? "admin" : null;
}

/** Classify a hostname as customer, or null if it's not a customer host. */
export function classifyCustomerHostname(
  hostname: string,
): "customer" | null {
  return CUSTOMER_HOSTS.has(hostname) ? "customer" : null;
}

/**
 * Top-level surface classifier. Returns null for unknown hosts so the
 * middleware can answer 404 (defense vs Host-header smuggling).
 */
export function classifySurface(hostname: string): Surface | null {
  if (CUSTOMER_HOSTS.has(hostname)) return "customer";
  if (ADMIN_HOSTS.has(hostname)) return "admin";
  return null;
}

/**
 * Build a new Request with its URL pathname rewritten for the given surface.
 *
 * For the admin surface, prepends `/admin` to the pathname so the
 * file-system router serves from `routes/admin/*`. The browser-visible URL
 * is unchanged because we never write a redirect — we transparently rewrite
 * the in-flight Request before Fresh's router sees it.
 *
 * The new Request preserves: method, headers, body, mode, credentials,
 * referrer, redirect — everything except the URL pathname.
 */
export function rewriteRequestForSurface(
  original: Request,
  url: URL,
  surface: Surface,
): Request {
  if (surface !== "admin") return original;
  const rewritten = new URL(url.toString());
  rewritten.pathname = "/admin" + rewritten.pathname.replace(/\/$/, "");
  // Trailing-slash normalization: keep "/" → "/admin", not "/admin/".
  if (url.pathname === "/") rewritten.pathname = "/admin";
  // Build the new Request. Body is forwarded for non-GET/HEAD methods only.
  const init: RequestInit = {
    method: original.method,
    headers: original.headers,
    redirect: original.redirect,
    referrer: original.referrer,
    referrerPolicy: original.referrerPolicy,
    mode: original.mode,
    credentials: original.credentials,
    cache: original.cache,
    integrity: original.integrity,
    keepalive: original.keepalive,
  };
  if (original.method !== "GET" && original.method !== "HEAD") {
    init.body = original.body;
    // @ts-ignore duplex required when forwarding a streaming body in Deno.
    init.duplex = "half";
  }
  return new Request(rewritten.toString(), init);
}

/** Whitelist of paths that bypass the admin path rewrite. */
export function isShellOrApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_fresh") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/assets") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.admin.json" ||
    pathname === "/robots.txt" ||
    pathname === "/apple-touch-icon.png" ||
    /^\/favicon-(16|32|48|180|192|512)\.png$/.test(pathname)
  );
}
