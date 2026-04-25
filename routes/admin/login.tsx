import { define } from "../../utils.ts";
import LoginForm from "../../islands/LoginForm.tsx";
import ForgotPasswordForm from "../../islands/admin/ForgotPasswordForm.tsx";
import { GridPattern } from "../../components/magicui/grid-pattern.tsx";
import { Particles } from "../../components/magicui/particles.tsx";
import { ShineBorder } from "../../components/magicui/shine-border.tsx";
import { ExpresSyncBrand } from "../../components/brand/ExpresSyncBrand.tsx";
import { BlurFade } from "../../components/magicui/blur-fade.tsx";
import { isEmailEnabled } from "../../src/lib/email.ts";

interface LoginPageData {
  /** Hide the forgot-password trigger when the email worker isn't
   *  configured — admins can't receive a reset link otherwise. */
  forgotPasswordEnabled: boolean;
}

export const handler = define.handlers({
  GET() {
    return {
      data: {
        forgotPasswordEnabled: isEmailEnabled(),
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
              <ExpresSyncBrand
                variant="login"
                showParticles
              />
            </div>
          </div>
        </BlurFade>

        {/* Login form with shine border */}
        <BlurFade delay={0.2} duration={0.5} direction="up">
          <div class="relative">
            <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
              <LoginForm />
            </ShineBorder>
            <a
              href="/login"
              class="absolute right-4 top-0 z-20 -translate-y-1/2 inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-background px-3 py-1 text-xs font-medium text-sky-600 shadow-sm transition-colors hover:bg-muted hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
            >
              Customer login →
            </a>
          </div>
        </BlurFade>

        {
          /* Forgot-password trigger — collapsed by default; expands inline.
            Hidden entirely when the email worker isn't configured (no
            reset link can be sent). Admin recovers via direct DB access. */
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
