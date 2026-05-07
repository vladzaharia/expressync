/**
 * Portal handoff helpers.
 *
 * Used by `routes/handoff/admin.tsx` and `routes/admin/handoff/customer.tsx`
 * to drive the cross-portal switcher. The two routes are intentionally
 * thin — they delegate the device-session lookup, the optional
 * server-side `setActiveSession` call, and the cookie forwarding to this
 * module so the loader bodies stay declarative.
 *
 * Why server-side at all? When the visitor has an existing session on
 * the device that matches the destination surface, we want a frictionless
 * 302 — no extra click, no flicker. Client-side `setActive + window.assign`
 * works but races against the cookie write. Forwarding `Set-Cookie`
 * headers from `setActiveSession({ asResponse: true })` onto our redirect
 * guarantees the browser has the active session cookie before it hits
 * the destination origin.
 */
import { auth } from "./auth.ts";

export type DesiredRole = "admin" | "customer";

export interface HandoffRow {
  session: { id: string; token: string; userId: string };
  user: {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
    role?: string | null;
  };
}

export async function listHandoffSessions(
  headers: Headers,
): Promise<HandoffRow[]> {
  try {
    const data = await auth.api.listDeviceSessions({ headers });
    if (!Array.isArray(data)) return [];
    return data as unknown as HandoffRow[];
  } catch {
    // Cookie missing or auth tunnel unavailable — caller treats as empty.
    return [];
  }
}

/**
 * If the device has a session whose user.role matches `desiredRole`,
 * activate it server-side and return a 302 to `targetUrl` with the
 * resulting Set-Cookie headers forwarded. Otherwise return null so the
 * caller can render the picker.
 */
export async function autoSwitchOrNull(
  rows: HandoffRow[],
  desiredRole: DesiredRole,
  reqHeaders: Headers,
  targetUrl: string,
): Promise<Response | null> {
  const match = rows.find((r) => (r.user.role ?? "customer") === desiredRole);
  if (!match) return null;

  const switchResp = await auth.api.setActiveSession({
    body: { sessionToken: match.session.token },
    headers: reqHeaders,
    asResponse: true,
  });

  const headers = new Headers({ Location: targetUrl });
  // Better Auth may emit multiple Set-Cookie entries (active session +
  // session-data variant). Forward each individually so the browser
  // commits all of them.
  const setCookieValues = (switchResp.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie?.() ?? [];
  if (setCookieValues.length > 0) {
    for (const v of setCookieValues) headers.append("set-cookie", v);
  } else {
    // Fallback for runtimes without getSetCookie() — iterate entries.
    for (const [k, v] of switchResp.headers.entries()) {
      if (k.toLowerCase() === "set-cookie") headers.append("set-cookie", v);
    }
  }
  return new Response(null, { status: 302, headers });
}

/**
 * Compute the destination origin for the desired surface.
 * Mirrors the env-driven base URLs used by the rest of the codebase
 * (`config.CUSTOMER_BASE_URL`, `config.ADMIN_BASE_URL`).
 */
export function destinationOrigin(
  desired: DesiredRole,
  customerBaseUrl: string,
  adminBaseUrl: string,
): string {
  return desired === "admin" ? adminBaseUrl : customerBaseUrl;
}
