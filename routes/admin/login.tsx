/**
 * GET /login (admin surface) — file-system path: routes/admin/login.tsx.
 *
 * ExpresScan / Wave 1 Track A — 3-mode admin login UI:
 *
 *   1. ADMIN_OIDC_ISSUER unset → render the email/password form (legacy).
 *   2. ADMIN_OIDC_ISSUER set + ADMIN_AUTH_SHOW_FALLBACK unset → render
 *      the OIDC button and auto-kick the sign-in on mount via an island.
 *   3. ADMIN_OIDC_ISSUER set + ADMIN_AUTH_SHOW_FALLBACK=true → render
 *      the OIDC button (primary CTA) plus a small "Sign in with email
 *      instead" link → /login/email (the email form on its own page).
 *
 * The OIDC button POSTs JSON against BetterAuth's
 * `/api/auth/sign-in/oauth2` with `providerId=pocket-id` (matching
 * `auth-oidc.ts`). BetterAuth resolves the discovery document, signs
 * PKCE state into a cookie, and returns the authorize URL as
 * `{url, redirect}` JSON; the island then sets `window.location.href`.
 * (BetterAuth's sign-in endpoint accepts JSON only and does not 302 —
 * a plain `<form method="POST">` would render the JSON response.)
 */

import { define } from "../../utils.ts";
import LoginForm from "../../islands/LoginForm.tsx";
import OidcAutoSubmit from "../../islands/admin/OidcAutoSubmit.tsx";
import ForgotPasswordForm from "../../islands/admin/ForgotPasswordForm.tsx";
import { GridPattern } from "../../components/magicui/grid-pattern.tsx";
import { Particles } from "../../components/magicui/particles.tsx";
import { ShineBorder } from "../../components/magicui/shine-border.tsx";
import { ExpressChargeBrand } from "../../components/brand/ExpressChargeBrand.tsx";
import { BlurFade } from "../../components/magicui/blur-fade.tsx";
import { isEmailEnabled } from "../../src/lib/email.ts";
import { config } from "../../src/lib/config.ts";

interface LoginPageData {
  /**
   * Admin auth mode (server-resolved):
   *   - "password": legacy email/password form only (no OIDC configured).
   *   - "oidc-only": OIDC button auto-submitted on mount.
   *   - "oidc-with-fallback": OIDC button primary + email link below.
   */
  mode: "password" | "oidc-only" | "oidc-with-fallback";
  /** Hide the forgot-password trigger when the email worker isn't
   *  configured — admins can't receive a reset link otherwise. */
  forgotPasswordEnabled: boolean;
  /**
   * Sanitised `?next=<path>` value plumbed through from the middleware
   * (e.g. iOS ExpresScan deep-link returns the admin to
   * `/app/register?codeChallenge=…`). Always begins with "/" and
   * never "//"; defaults to "/".
   */
  next: string;
  /**
   * URL of the customer-surface login. Mirrors the customer page's
   * `adminLoginUrl` so the two surfaces cross-link. `null` when the
   * admin landed here from an admin-only context (device-registration
   * deep link, etc.) — there's no customer counterpart in those flows
   * so a "Customer login →" link would be a dead end.
   */
  customerLoginUrl: string | null;
}

/** `?next=` paths that only make sense on the admin surface — when one of
 *  these is in flight, hide the cross-link to the customer login since
 *  the customer surface can't fulfil the deep link. */
function isAdminOnlyContext(next: string): boolean {
  return next.startsWith("/app/") ||
    next.startsWith("/admin/") ||
    next === "/admin";
}

function sanitizeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const next = sanitizeNext(url.searchParams.get("next"));

    const oidcEnabled = config.ADMIN_OIDC_ISSUER.length > 0 &&
      config.ADMIN_OIDC_CLIENT_ID.length > 0;

    const customerLoginUrl = isAdminOnlyContext(next)
      ? null
      : `${config.CUSTOMER_BASE_URL}/login`;

    if (oidcEnabled && !config.ADMIN_AUTH_SHOW_FALLBACK) {
      return {
        data: {
          mode: "oidc-only" as const,
          forgotPasswordEnabled: false,
          next,
          customerLoginUrl,
        } satisfies LoginPageData,
      };
    }
    if (oidcEnabled && config.ADMIN_AUTH_SHOW_FALLBACK) {
      return {
        data: {
          mode: "oidc-with-fallback" as const,
          forgotPasswordEnabled: isEmailEnabled(),
          next,
          customerLoginUrl,
        } satisfies LoginPageData,
      };
    }
    return {
      data: {
        mode: "password" as const,
        forgotPasswordEnabled: isEmailEnabled(),
        next,
        customerLoginUrl,
      } satisfies LoginPageData,
    };
  },
});

export default define.page<typeof handler>(function LoginPage({ data }) {
  return (
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Animated particles background */}
      <Particles
        className="absolute inset-0 -z-5"
        quantity={80}
        staticity={30}
        color="#0ea5e9"
        size={0.6}
      />

      {/* Background pattern */}
      <GridPattern
        width={40}
        height={40}
        className="absolute inset-0 -z-10 opacity-10"
        squares={[[1, 1], [3, 3], [5, 2], [2, 5], [7, 4], [4, 7], [6, 1], [
          8,
          6,
        ]]}
      />

      {/* Gradient overlay */}
      <div class="absolute inset-0 -z-10 bg-gradient-to-br from-background via-background/95 to-primary/5" />

      <div class="relative z-10 w-full max-w-md px-4">
        {/* Logo with Ripple effect */}
        <BlurFade delay={0} duration={0.5} direction="down">
          <div class="flex justify-center mb-8">
            <div class="relative">
              <ExpressChargeBrand
                variant="login"
                showParticles
              />
            </div>
          </div>
        </BlurFade>

        {
          /* Login form with shine border. Mirrors the customer page's
            "Admin login →" pill: a small floating link top-right, hidden
            when this is an admin-only flow (device registration etc.) so
            we don't dead-end the user on the customer surface. */
        }
        <BlurFade delay={0.2} duration={0.5} direction="up">
          <div class="relative">
            <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
              {data.mode === "password" && <LoginForm />}
              {data.mode === "oidc-only" && (
                <div class="w-full max-w-md mx-auto p-6">
                  <h1 class="text-2xl font-bold text-center mb-1">
                    Continue with Pocket ID
                  </h1>
                  <p class="text-sm text-center text-muted-foreground mb-5">
                    Redirecting you to your single sign-on provider…
                  </p>
                  <OidcAutoSubmit
                    callbackURL={data.next}
                    autoSubmit
                    label="Continue with Pocket ID"
                  />
                  <noscript>
                    <p class="mt-3 text-center text-xs text-destructive">
                      JavaScript is required to sign in with Pocket ID.
                    </p>
                  </noscript>
                </div>
              )}
              {data.mode === "oidc-with-fallback" && (
                <div class="w-full max-w-md mx-auto p-6 space-y-4">
                  <h1 class="text-2xl font-bold text-center">
                    Welcome back
                  </h1>
                  <p class="text-sm text-center text-muted-foreground">
                    Sign in with your Pocket ID single sign-on.
                  </p>
                  <OidcAutoSubmit
                    callbackURL={data.next}
                    label="Continue with Pocket ID"
                  />
                  <div class="pt-1 text-center">
                    <a
                      href={data.next === "/"
                        ? "/login/email"
                        : `/login/email?next=${encodeURIComponent(data.next)}`}
                      class="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Sign in with email instead
                    </a>
                  </div>
                </div>
              )}
            </ShineBorder>
            {data.customerLoginUrl && (
              <a
                href={data.customerLoginUrl}
                class="absolute right-4 top-0 z-20 -translate-y-1/2 inline-flex items-center gap-1 rounded-full border border-slate-500/40 bg-background px-3 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-muted hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-200"
              >
                Customer login →
              </a>
            )}
          </div>
        </BlurFade>

        {
          /* Forgot-password trigger — collapsed by default; expands inline.
            Hidden entirely when the email worker isn't configured (no
            reset link can be sent). Admin recovers via direct DB access.
            Only shown in password / fallback modes — pure-OIDC has no
            email/password to forget (handler sets forgotPasswordEnabled=
            false in that branch). */
        }
        {data.forgotPasswordEnabled && (
          <BlurFade delay={0.35} duration={0.5} direction="up">
            <div class="mt-3 px-1">
              <ForgotPasswordForm />
            </div>
          </BlurFade>
        )}
      </div>
    </div>
  );
});
