/**
 * Polaris Track A — same-origin enforcement.
 *
 * Defense beyond SameSite=Lax: explicitly checks the Origin header on every
 * state-changing request and rejects with 403 if it doesn't match a trusted
 * origin. Browser-issued POST/PUT/PATCH/DELETE requests always send Origin;
 * a missing Origin (e.g. server-to-server, curl) is treated as untrusted.
 *
 * Trusted origins:
 *   - canonical AUTH_URL (the customer host)
 *   - ADMIN_BASE_URL (the admin host)
 *   - dev-mode loopback variants
 *
 * Applied:
 *   - In `_middleware.ts` on every state-changing method.
 *   - At each customer endpoint as a defense-in-depth — if a future
 *     middleware refactor accidentally short-circuits the check, the
 *     handlers still reject.
 */

import type { FreshContext } from "fresh";
import { config } from "./config.ts";
import type { State } from "@/utils.ts";

/** Trusted origins, derived from config + dev-mode allowances. */
export function getTrustedOrigins(): readonly string[] {
  const list = new Set<string>([
    config.AUTH_URL,
    config.ADMIN_BASE_URL,
  ]);
  if (config.DENO_ENV === "development") {
    list.add("http://localhost:5173");
    list.add("http://127.0.0.1:5173");
    list.add("http://localhost:8000");
    list.add("http://127.0.0.1:8000");
    list.add("http://manage.polaris.localhost:5173");
    list.add("http://polaris.localhost:5173");
    list.add("http://manage.polaris.localhost:8000");
    list.add("http://polaris.localhost:8000");
  }
  // Strip trailing slashes so comparisons are stable.
  return [...list].map((u) => u.replace(/\/+$/, ""));
}

/**
 * Throws an `OriginMismatchError` (status 403) if the Origin header is
 * absent or does not match a trusted origin. GET / HEAD / OPTIONS bypass.
 *
 * Returns the trusted origin string when allowed (useful in handlers that
 * need to vary CORS headers). Throws otherwise — never returns null.
 */
export function assertSameOrigin(
  ctx: { req: Request } | FreshContext<State>,
): string {
  const req = "req" in ctx ? ctx.req : (ctx as FreshContext<State>).req;
  const method = req.method.toUpperCase();
  // Read methods are exempt — Origin enforcement is for state-changing flows.
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return req.headers.get("origin") ?? "";
  }
  const origin = req.headers.get("origin");
  if (!origin) {
    throw new OriginMismatchError(
      "Missing Origin header on state-changing request",
    );
  }
  const normalized = origin.replace(/\/+$/, "");
  const trusted = getTrustedOrigins();
  if (!trusted.includes(normalized)) {
    throw new OriginMismatchError(
      `Origin '${origin}' is not in the trusted list`,
    );
  }
  return normalized;
}

/** Thrown when `assertSameOrigin` rejects. Status 403. */
export class OriginMismatchError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "OriginMismatchError";
  }
}

/**
 * Convenience: turns the thrown OriginMismatchError into a uniform 403
 * Response with a sanitized body. Use at API handler edges that catch
 * `assertSameOrigin` failures and want to respond directly.
 */
export function originMismatchResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Forbidden: origin mismatch" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}
