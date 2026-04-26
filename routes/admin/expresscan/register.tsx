/**
 * GET / POST /expresscan/register (admin surface; file path post-rewrite is
 * `/admin/expresscan/register`).
 *
 * ExpresScan / Wave 2 Track B-lifecycle — server-rendered admin page that
 * the iOS app's `ASWebAuthenticationSession` opens during device registration.
 *
 * Flow (`30-backend.md` § "Registration flow (PKCE)" steps 1–8):
 *
 *   1. iOS opens
 *      `https://manage.polaris.express/expresscan/register?codeChallenge=…&label=…`
 *      inside its auth-session sandbox. The host's existing cookie session
 *      is used; the user signs in via the normal admin login flow if they
 *      aren't already.
 *
 *   2. The server reads `ctx.state.user` (admin-cookie required by the
 *      route classifier — `_middleware.ts` enforces admin-only on
 *      `/admin/*` paths).
 *
 *   3. GET renders a tiny "Register this iPhone" confirmation page. The
 *      label defaults to the value passed in the query string but the
 *      admin can edit it. There's exactly one form, posting back to this
 *      same URL.
 *
 *   4. POST validates the body, calls `mintOneTimeCode(userId, codeChallenge,
 *      label, capabilities)` to insert the `verifications` row, and 302s
 *      to the Universal-Link callback target —
 *      `{ADMIN_BASE_URL}/expresscan/register/callback?code={oneTimeCode}`.
 *
 *   5. iOS's app-association manifest claims the `/expresscan/register/*`
 *      path family, so the OS hands the URL to the app instead of opening
 *      it in Safari. The app reads `?code=…`, drops the
 *      `ASWebAuthenticationSession`, and POSTs `/api/devices/register`
 *      with `{oneTimeCode, codeVerifier, …}`.
 *
 *   6. `/api/devices/register` atomically claims the row + mints
 *      `(deviceToken, deviceSecret)`.
 *
 * The codeChallenge is the only sensitive value on the URL, and it's safe
 * by design (PKCE — without the verifier it's useless). The raw oneTimeCode
 * lives only briefly in the redirect URL the iOS-deep-link receives,
 * single-use enforced.
 *
 * Security:
 *   - The cookie session must be admin-role; the route classifier already
 *     forces this (UNKNOWN → ADMIN_ONLY default + `/admin/*` ADMIN_ONLY).
 *     We belt-and-braces re-check `ctx.state.user.role === 'admin'` here.
 *   - `codeChallenge` is sanity-checked: 43..128 chars, base64url alphabet.
 *     The PKCE spec floor is 43 (43 chars of base64url == 32 bytes → 256-bit
 *     security).
 *   - The label is HTML-encoded by Preact's renderer; no XSS surface from
 *     URL params.
 *   - We do NOT validate the `codeChallenge` against any registered list —
 *     the verifier check at `/api/devices/register` is the actual gate.
 */

import { define } from "../../../utils.ts";
import { config } from "../../../src/lib/config.ts";
import { mintOneTimeCode } from "../../../src/lib/devices/registration.ts";
import { DEVICE_CAPABILITIES } from "../../../src/lib/types/devices.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ExpresScanRegisterPage");

const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const LABEL_MAX = 120;

interface PageData {
  /** PKCE challenge from the iOS app — passed through as a hidden form field. */
  codeChallenge: string;
  /** Pre-filled device label. */
  defaultLabel: string;
  /** Inline error message (only set on POST validation failure). */
  error: string | null;
  /** True iff the cookie session resolved to an admin user. */
  hasAdmin: boolean;
}

function isValidChallenge(c: string): boolean {
  return CODE_CHALLENGE_RE.test(c);
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const codeChallenge = (url.searchParams.get("codeChallenge") ?? "").trim();
    const labelParam = (url.searchParams.get("label") ?? "").slice(
      0,
      LABEL_MAX,
    );

    return {
      data: {
        codeChallenge,
        defaultLabel: labelParam || "iPhone",
        error: null,
        hasAdmin: ctx.state.user?.role === "admin",
      } satisfies PageData,
    };
  },

  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }
    const adminUserId = ctx.state.user.id;

    const form = await ctx.req.formData();
    const codeChallenge = String(form.get("codeChallenge") ?? "").trim();
    const label = String(form.get("label") ?? "").trim().slice(0, LABEL_MAX);

    if (!isValidChallenge(codeChallenge)) {
      return {
        data: {
          codeChallenge,
          defaultLabel: label || "iPhone",
          error: "Invalid registration link. Restart from the iOS app.",
          hasAdmin: true,
        } satisfies PageData,
      };
    }
    if (!label) {
      return {
        data: {
          codeChallenge,
          defaultLabel: "iPhone",
          error: "Label is required.",
          hasAdmin: true,
        } satisfies PageData,
      };
    }

    let oneTimeCode: string;
    try {
      oneTimeCode = await mintOneTimeCode(
        adminUserId,
        codeChallenge,
        label,
        // Default v1 capabilities — admin can pre-approve more from the
        // admin devices page later. The contract `requestedCapabilities`
        // on /api/devices/register must be a non-empty subset of these.
        ["tap", ...DEVICE_CAPABILITIES.filter((c) => c !== "tap")].slice(0, 1),
      );
    } catch (err) {
      log.error("mintOneTimeCode failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        data: {
          codeChallenge,
          defaultLabel: label,
          error: "Could not generate registration code. Try again.",
          hasAdmin: true,
        } satisfies PageData,
      };
    }

    // 302 to the Universal Link target. iOS's app-association manifest
    // (served at /.well-known/apple-app-site-association) claims this
    // path, so the OS hands the URL to the app instead of opening it
    // in Safari. The raw oneTimeCode is single-use, 60s-TTL, hashed at
    // rest — short-lived URL exposure is acceptable per the design.
    const callback = new URL(
      `${config.ADMIN_BASE_URL}/expresscan/register/callback`,
    );
    callback.searchParams.set("code", oneTimeCode);

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: callback.toString(),
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
    return response;
  },
});

export default define.page<typeof handler>(function ExpresScanRegister(
  { data },
) {
  if (!data.hasAdmin) {
    // The middleware should have already redirected non-admins, but
    // belt-and-braces: render a stub so unauthenticated requests don't
    // see a half-rendered form.
    return (
      <div class="min-h-screen flex items-center justify-center bg-background">
        <p class="text-sm text-muted-foreground">
          Sign in as an admin to register a device.
        </p>
      </div>
    );
  }

  return (
    <div class="min-h-screen flex items-center justify-center bg-background p-4">
      <div class="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 class="text-2xl font-semibold mb-2">Register this iPhone</h1>
        <p class="text-sm text-muted-foreground mb-5">
          Tap "Register" to issue this device a unique scanner identity. You'll
          see it in the Devices list once it's set up.
        </p>

        {data.error && (
          <p class="mb-4 rounded-md bg-destructive/10 border border-destructive/40 px-3 py-2 text-sm text-destructive">
            {data.error}
          </p>
        )}

        <form method="POST" class="space-y-4">
          <input
            type="hidden"
            name="codeChallenge"
            value={data.codeChallenge}
          />
          <div class="space-y-2">
            <label
              for="label"
              class="block text-sm font-medium text-foreground"
            >
              Device label
            </label>
            <input
              type="text"
              id="label"
              name="label"
              defaultValue={data.defaultLabel}
              maxLength={LABEL_MAX}
              required
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p class="text-xs text-muted-foreground">
              Visible to other admins so they know which iPhone is which.
            </p>
          </div>

          <button
            type="submit"
            class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Register iPhone
          </button>

          <p class="text-xs text-muted-foreground text-center">
            One-time code expires in 60 seconds.
          </p>
        </form>
      </div>
    </div>
  );
});
