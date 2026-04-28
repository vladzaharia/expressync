/**
 * GET /expresscan/register (admin surface; file path post-rewrite is
 * `/admin/expresscan/register`).
 *
 * ExpresScan / Wave 2 Track B-lifecycle — silent server-side hop that the
 * iOS app's `ASWebAuthenticationSession` opens during device registration.
 * The page never asks the admin for input — the device label is collected
 * on the iOS native registration screen instead.
 *
 * Flow (`30-backend.md` § "Registration flow (PKCE)"):
 *
 *   1. iOS opens
 *      `https://manage.polaris.express/expresscan/register?codeChallenge=…&label=…`
 *      inside its auth-session sandbox. The host's existing cookie session
 *      is used; the user signs in via the normal admin login flow if they
 *      aren't already (the middleware bounces unauthenticated traffic to
 *      `/login?next=…`).
 *
 *   2. The GET handler reads `ctx.state.user` (admin-cookie required by
 *      the route classifier — `_middleware.ts` enforces admin-only on
 *      `/admin/*` paths), validates the PKCE `codeChallenge`, mints a
 *      single-use 60s-TTL one-time code via `mintOneTimeCode`, and
 *      returns a 200 HTML page that performs a top-level client-side
 *      navigation to `expresscan://register/callback?code={oneTimeCode}`.
 *
 *      We can't 302 directly: `ASWebAuthenticationSession`'s in-session
 *      `WKWebView` silently drops a cross-scheme `Location` redirect (see
 *      commit af88234). A top-level GET to the custom scheme, driven by
 *      `location.replace` / `<meta http-equiv="refresh">`, IS observed
 *      by the navigation policy delegate and matched against
 *      `callbackURLScheme: "expresscan"`, so the auth sheet dismisses
 *      and the completion handler fires.
 *
 *   3. The iOS app reads `?code=…`, drops the auth session, transitions
 *      to the native `RegistrationView` (which collects the device
 *      label), and POSTs `/api/devices/register` with `{oneTimeCode,
 *      codeVerifier, label, …}`.
 *
 *   4. `/api/devices/register` atomically claims the verification row
 *      and mints `(deviceToken, deviceSecret)`.
 *
 * The codeChallenge is the only sensitive value on the URL, and it's safe
 * by design (PKCE — without the verifier it's useless). The raw oneTimeCode
 * lives only briefly in the redirect URL the iOS auth session intercepts;
 * single-use enforced.
 *
 * GET-with-side-effect note: minting a verification row from a GET
 * deviates from "GET is safe/idempotent." It's deliberate here — the
 * codeChallenge is single-use per iOS sign-in, the row's TTL is 60s, and
 * we want the auth session to feel instant (no extra confirmation tap).
 * The middleware's same-origin / Origin-header check is exempt for read
 * methods, so dropping the POST surface area also drops a CSRF concern
 * we didn't actually have (admin cookie + single-use code already gated
 * the original POST).
 *
 * Security:
 *   - The cookie session must be admin-role; the route classifier already
 *     forces this (UNKNOWN → ADMIN_ONLY default + `/admin/*` ADMIN_ONLY).
 *     We belt-and-braces re-check `ctx.state.user.role === 'admin'` here.
 *   - `codeChallenge` is sanity-checked: 43..128 chars, base64url alphabet.
 *     The PKCE spec floor is 43 (43 chars of base64url == 32 bytes → 256-bit
 *     security).
 *   - The `label` query param is passed through to `mintOneTimeCode` as a
 *     hint only — the iOS app's `/api/devices/register` body carries the
 *     authoritative label, so injecting a bogus value here has no effect
 *     on the registered device.
 */

import { define } from "../../../utils.ts";
import { mintOneTimeCode } from "../../../src/lib/devices/registration.ts";
import { DEVICE_CAPABILITIES } from "../../../src/lib/types/devices.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ExpresScanRegisterPage");

const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const LABEL_MAX = 120;

interface PageData {
  /** Why the silent-redirect path was bypassed. `null` is unreachable —
   * the GET handler returns a `Response` on the happy path so this page
   * renderer never sees it. */
  reason: "missing_admin" | "invalid_challenge" | "mint_failed";
}

function isValidChallenge(c: string): boolean {
  return CODE_CHALLENGE_RE.test(c);
}

/**
 * Build the 200 HTML response that drives the auth-session WKWebView's
 * navigation to the `expresscan://` callback. Inlined CSS / styling
 * mirrors the brand colors in `static/logo.svg` and matches the same
 * spinner the iOS RegistrationView shows, so the brief flash between
 * dismiss and the native screen looks intentional.
 */
function htmlRedirect(oneTimeCode: string): Response {
  const callback = new URL("expresscan://register/callback");
  callback.searchParams.set("code", oneTimeCode);
  const callbackUrl = callback.toString();
  // The URL is built by `URL` so `oneTimeCode` (base64url, A–Z / a–z /
  // 0–9 / `_` / `-`) cannot introduce HTML-significant characters; the
  // JSON.stringify form is used for `location.replace(…)`.
  const callbackJson = JSON.stringify(callbackUrl);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#06b6d4">
<title>Returning to ExpressCharge…</title>
<meta http-equiv="refresh" content="0;url=${callbackUrl}">
<script>location.replace(${callbackJson});</script>
<style>
:root {
  color-scheme: dark light;
  --bg: #0a0a0a;
  --fg: #fafafa;
  --muted: #a1a1aa;
  --border: #27272a;
  --accent: #06b6d4;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #ffffff; --fg: #0a0a0a; --muted: #71717a; --border: #e4e4e7; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: radial-gradient(ellipse at top, color-mix(in oklab, var(--accent) 12%, var(--bg)) 0%, var(--bg) 60%);
  color: var(--fg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  max-width: 360px;
  text-align: center;
}
.logo {
  width: 72px;
  height: 72px;
  border-radius: 22px;
  background: linear-gradient(135deg, #06b6d4 0%, #22c55e 55%, #06b6d4 100%);
  display: grid;
  place-items: center;
  box-shadow: 0 10px 40px -12px color-mix(in oklab, var(--accent) 50%, transparent);
}
.logo svg { width: 38px; height: 38px; }
h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.muted { color: var(--muted); font-size: 13px; margin: 0; }
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in oklab, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.row { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; }
.fallback {
  margin-top: 6px;
  display: inline-block;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--fg);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  background: color-mix(in oklab, var(--accent) 4%, transparent);
}
.fallback:hover { background: color-mix(in oklab, var(--accent) 10%, transparent); }
</style>
</head>
<body>
<div class="card">
  <div class="logo" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="0.6" stroke-linejoin="round">
      <path d="M13 2 L3 14 h9 l-1 8 L21 10 h-9 l1 -8 z" />
    </svg>
  </div>
  <h1>Returning to ExpressCharge…</h1>
  <div class="row"><span class="spinner" aria-hidden="true"></span><span>Finishing up</span></div>
  <p class="muted">You can close this window once the app reopens.</p>
  <a class="fallback" href="${callbackUrl}">Open ExpressCharge manually</a>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return { data: { reason: "missing_admin" } satisfies PageData };
    }
    const url = new URL(ctx.req.url);
    const codeChallenge = (url.searchParams.get("codeChallenge") ?? "").trim();
    const labelParam = (url.searchParams.get("label") ?? "").slice(0, LABEL_MAX)
      .trim() || "iPhone";

    if (!isValidChallenge(codeChallenge)) {
      return { data: { reason: "invalid_challenge" } satisfies PageData };
    }

    let oneTimeCode: string;
    try {
      oneTimeCode = await mintOneTimeCode(
        ctx.state.user.id,
        codeChallenge,
        labelParam,
        // Default v1 capabilities — admin can pre-approve more from the
        // admin devices page later. The contract `requestedCapabilities`
        // on /api/devices/register must be a non-empty subset of these.
        ["tap", ...DEVICE_CAPABILITIES.filter((c) => c !== "tap")].slice(0, 1),
      );
    } catch (err) {
      log.error("mintOneTimeCode failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { data: { reason: "mint_failed" } satisfies PageData };
    }

    return htmlRedirect(oneTimeCode);
  },
});

/** Page renderer is the error-only path. The happy path returns a
 * `Response` directly from the GET handler above and bypasses Fresh's
 * island/component pipeline (we want zero hydration delay before the
 * navigation fires). */
export default define.page<typeof handler>(function ExpresScanRegister(
  { data },
) {
  if (data.reason === "missing_admin") {
    // Middleware should have already redirected non-admins, but
    // belt-and-braces: render a stub so unauthenticated requests don't
    // see an empty page.
    return (
      <div class="min-h-screen flex items-center justify-center bg-background">
        <p class="text-sm text-muted-foreground">
          Sign in as an admin to register a device.
        </p>
      </div>
    );
  }

  if (data.reason === "invalid_challenge") {
    // Without a valid PKCE codeChallenge we can't mint a usable one-time
    // code (the iOS app's verifier wouldn't match). This page is reached
    // by the iOS app opening a deep link with the challenge as a query
    // param — a plain browser visit lands here too. Surface a loud
    // explanation rather than silently 400ing.
    return (
      <div class="min-h-screen flex items-center justify-center bg-background p-4">
        <div class="w-full max-w-md rounded-lg border border-amber-500/40 bg-amber-500/5 p-6 text-sm">
          <h1 class="mb-2 text-xl font-semibold text-amber-700 dark:text-amber-300">
            Open this page from the ExpressCharge app
          </h1>
          <p class="text-muted-foreground">
            This URL is the registration entry point for the iOS ExpressCharge app.
            Tap "Sign in" inside the app to start the flow — it will open this
            page with a one-time PKCE challenge attached and send you straight
            back to the app.
          </p>
          <p class="mt-3 text-xs text-muted-foreground">
            If you got here via a stale bookmark, return to the app and
            re-trigger sign-in; the URL you land on will include a{" "}
            <code class="font-mono">codeChallenge</code> parameter.
          </p>
        </div>
      </div>
    );
  }

  // mint_failed — surfaced when the DB / verifications insert blew up.
  return (
    <div class="min-h-screen flex items-center justify-center bg-background p-4">
      <div class="w-full max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <h1 class="mb-2 text-xl font-semibold text-destructive">
          Couldn't start registration
        </h1>
        <p class="text-muted-foreground">
          Something went wrong generating a registration code. Return to the
          ExpressCharge app and try Sign in again.
        </p>
      </div>
    </div>
  );
});
