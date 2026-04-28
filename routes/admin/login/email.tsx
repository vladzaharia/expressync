/**
 * GET /login/email (admin surface) — email/password fallback page.
 *
 * ExpresScan / Wave 1 Track A — surfaced from `routes/admin/login.tsx`
 * when `ADMIN_AUTH_SHOW_FALLBACK=true`. Hosts the existing email/password
 * form on its own URL so the OIDC button on the main /login page can
 * remain the primary CTA without flashing a password field.
 *
 * When OIDC is NOT configured (`ADMIN_OIDC_ISSUER` empty), this route
 * 302-redirects to `/login` — the legacy email/password form is shown
 * there directly and the duplicate page is just confusing.
 */

import { define } from "../../../utils.ts";
import LoginForm from "../../../islands/LoginForm.tsx";
import ForgotPasswordForm from "../../../islands/admin/ForgotPasswordForm.tsx";
import { GridPattern } from "../../../components/magicui/grid-pattern.tsx";
import { Particles } from "../../../components/magicui/particles.tsx";
import { ShineBorder } from "../../../components/magicui/shine-border.tsx";
import { ExpressChargeBrand } from "../../../components/brand/ExpressChargeBrand.tsx";
import { BlurFade } from "../../../components/magicui/blur-fade.tsx";
import { isEmailEnabled } from "../../../src/lib/email.ts";
import { config } from "../../../src/lib/config.ts";

interface EmailLoginPageData {
  forgotPasswordEnabled: boolean;
}

export const handler = define.handlers({
  GET(_ctx) {
    const oidcEnabled = config.ADMIN_OIDC_ISSUER.length > 0 &&
      config.ADMIN_OIDC_CLIENT_ID.length > 0;

    // No OIDC → /login already shows the email/password form. Redirect.
    if (!oidcEnabled) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login" },
      });
    }

    return {
      data: {
        forgotPasswordEnabled: isEmailEnabled(),
      } satisfies EmailLoginPageData,
    };
  },
});

export default define.page<typeof handler>(function AdminEmailLoginPage(
  { data },
) {
  return (
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      <Particles
        className="absolute inset-0 -z-5"
        quantity={80}
        staticity={30}
        color="#0ea5e9"
        size={0.6}
      />

      <GridPattern
        width={40}
        height={40}
        className="absolute inset-0 -z-10 opacity-10"
        squares={[[1, 1], [3, 3], [5, 2], [2, 5], [7, 4], [4, 7], [6, 1], [
          8,
          6,
        ]]}
      />

      <div class="absolute inset-0 -z-10 bg-gradient-to-br from-background via-background/95 to-primary/5" />

      <div class="relative z-10 w-full max-w-md px-4">
        <BlurFade delay={0} duration={0.5} direction="down">
          <div class="flex justify-center mb-8">
            <div class="relative">
              <ExpressChargeBrand variant="login" showParticles />
            </div>
          </div>
        </BlurFade>

        <BlurFade delay={0.2} duration={0.5} direction="up">
          <div class="relative">
            <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
              <LoginForm />
            </ShineBorder>
            <a
              href="/login"
              class="absolute right-4 top-0 z-20 -translate-y-1/2 inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-background px-3 py-1 text-xs font-medium text-sky-600 shadow-sm transition-colors hover:bg-muted hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
            >
              ← Back to SSO
            </a>
          </div>
        </BlurFade>

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
