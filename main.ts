import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { ensureLagoMetricSafety } from "./src/services/lago-safety.service.ts";
import {
  classifyAdminHostname,
  classifyCustomerHostname,
  rewriteRequestForSurface,
} from "./src/lib/hostname-dispatch.ts";

export const app = new App<State>();

/**
 * Polaris Track A — hostname dispatch + path rewrite.
 *
 * This rewrite layer runs BEFORE Fresh's file-system router resolves the
 * request, which is the only point at which we can change the URL that
 * Fresh dispatches against. Doing it here lets admins keep clean URLs
 * (`manage.polaris.express/sync`) while the file system serves from
 * `routes/admin/sync/`.
 *
 * Strategy:
 *   - The `staticFiles()` middleware below intercepts asset / build paths.
 *   - For everything else, we install a wrapper around the App's handler
 *     in `polarisCreateFetchHandler()` (re-exported below) so production
 *     deploys via `_fresh/server.js` also see the rewrite.
 *
 * The hostname classification + path rewrite logic lives in
 * `src/lib/hostname-dispatch.ts` so the same code runs for both dev (vite)
 * and prod (`_fresh/server.js`) — the production build re-imports the
 * helper at request time.
 */

app.use(staticFiles());

// Include file-system based routes here
app.fsRoutes();

// Phase D: verify Lago billable metric aggregation type on web-app startup.
// Fire-and-forget — never blocks serving.
ensureLagoMetricSafety().catch(() => {/* already logged */});

/**
 * Wraps the Fresh App handler with a hostname-driven URL rewrite. When the
 * request hits `manage.polaris.express`, the path is rewritten to prepend
 * `/admin` (so `/sync` becomes `/admin/sync`); the customer host is left
 * alone. Static + Fresh internals + API paths are also left alone.
 *
 * Used by the production server bootstrap and by tests. Dev (vite) wires
 * this through Fresh's Vite plugin which honors the same `App.use` chain
 * indirectly via this same module.
 */
export function polarisCreateFetchHandler(): (
  req: Request,
  info?: Deno.ServeHandlerInfo,
) => Promise<Response> {
  // deno-lint-ignore no-explicit-any
  const inner = (app as any).handler() as (
    req: Request,
    info?: Deno.ServeHandlerInfo,
  ) => Promise<Response>;
  return async (req: Request, info?: Deno.ServeHandlerInfo) => {
    const url = new URL(req.url);
    const hostname = url.hostname.toLowerCase();
    let rewritten = req;
    if (
      classifyAdminHostname(hostname) === "admin" &&
      shouldRewriteAdminPath(url.pathname)
    ) {
      rewritten = rewriteRequestForSurface(req, url, "admin");
    } else if (classifyCustomerHostname(hostname) === "customer") {
      // Customer surface uses original paths; no rewrite.
    }
    return await inner(rewritten, info);
  };
}

/**
 * Skip the path rewrite for static assets, Fresh build internals, and
 * shared API paths (auth, health, webhooks). Everything else on the admin
 * surface gets `/admin` prepended.
 */
function shouldRewriteAdminPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_fresh")) return false;
  if (pathname.startsWith("/static")) return false;
  if (pathname.startsWith("/assets")) return false;
  if (pathname === "/favicon.ico") return false;
  if (pathname === "/manifest.json") return false;
  if (pathname === "/manifest.admin.json") return false;
  if (pathname === "/robots.txt") return false;
  // Static favicon PNGs (admin: /favicon-*.png; customer: /polaris-favicon-*.png;
  // shared: /apple-touch-icon.png) live at the URL root and are served by
  // Fresh's static-files middleware. Skip the rewrite so the assets resolve
  // before the admin path-rewrite would mangle them into /admin/favicon-X.png.
  if (
    /^\/(favicon|polaris-favicon)-(16|32|48|180|192|512)\.png$/.test(pathname)
  ) {
    return false;
  }
  if (pathname === "/apple-touch-icon.png") return false;
  // Avoid double-prepending if path already has /admin (shouldn't happen
  // in normal browser navigation but defends against intermediate proxies).
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return false;
  return true;
}
