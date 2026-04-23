/**
 * GET /login (customer surface)
 *
 * Polaris Track E — customer login landing. Lives at
 * `polaris.express/login`. Mobile-first, warm copy, magic-link primary,
 * scan-to-sign-in secondary. No discoverable link to `/admin/login`.
 *
 * The route is fully server-rendered chrome with two interactive islands:
 *   - `CustomerScanLoginIsland`  — opens the scan-to-login modal.
 *   - `CustomerLoginForm`        — POSTs the magic-link preflight.
 *
 * Deep-link support: `?scan=1` (and optional `?chargeBoxId=...`) auto-opens
 * the scan modal so QR-code arrivals via `/auth/scan` jump straight in.
 */

import { define } from "../utils.ts";
import { config } from "../src/lib/config.ts";
import {
  FEATURE_MAGIC_LINK,
  FEATURE_SCAN_LOGIN,
} from "../src/lib/feature-flags.ts";
import { PolarisExpressBrand } from "../components/brand/PolarisExpressBrand.tsx";
import { Particles } from "../components/magicui/particles.tsx";
import { BlurFade } from "../components/magicui/blur-fade.tsx";
import CustomerLoginForm from "../islands/customer/CustomerLoginForm.tsx";
import CustomerScanLoginIsland from "../islands/customer/CustomerScanLoginIsland.tsx";

interface CustomerLoginData {
  operatorEmail: string;
  scanLoginEnabled: boolean;
  magicLinkEnabled: boolean;
  autoOpenScan: boolean;
  initialChargeBoxId: string | null;
  defaultEmail: string;
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const scanParam = url.searchParams.get("scan");
    const chargerParam = url.searchParams.get("chargeBoxId");
    const emailParam = url.searchParams.get("email") ?? "";
    return {
      data: {
        operatorEmail: config.OPERATOR_CONTACT_EMAIL,
        scanLoginEnabled: FEATURE_SCAN_LOGIN,
        magicLinkEnabled: FEATURE_MAGIC_LINK,
        autoOpenScan: scanParam === "1",
        initialChargeBoxId: chargerParam,
        defaultEmail: emailParam,
      } satisfies CustomerLoginData,
    };
  },
});

export default define.page<typeof handler>(function CustomerLoginPage(
  { data },
) {
  return (
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-background px-4 py-10">
      {/* Subtle particles background — gentle warm touch on the customer surface. */}
      <Particles
        className="absolute inset-0 -z-10"
        quantity={50}
        staticity={40}
        color="#0E7C66"
        size={0.6}
      />

      {/* Soft radial gradient overlay so the brand glow lifts off the page. */}
      <div class="absolute inset-0 -z-10 bg-gradient-to-b from-background via-background/95 to-primary/5" />

      <div class="relative z-10 w-full max-w-md">
        <BlurFade delay={0} duration={0.4} direction="down">
          <div class="flex justify-center mb-6">
            <PolarisExpressBrand variant="login" showParticles />
          </div>
        </BlurFade>

        <BlurFade delay={0.1} duration={0.4} direction="up">
          <div class="text-center mb-6 space-y-1">
            <h1 class="text-2xl font-semibold text-foreground">
              Welcome to Polaris Express
            </h1>
            <p class="text-sm text-muted-foreground">
              Sign in to manage your charging
            </p>
          </div>
        </BlurFade>

        <BlurFade delay={0.2} duration={0.4} direction="up">
          <div class="rounded-2xl border border-border bg-card/80 backdrop-blur-sm shadow-lg p-5 sm:p-6 space-y-5">
            {data.scanLoginEnabled
              ? (
                <CustomerScanLoginIsland
                  autoOpen={data.autoOpenScan}
                  initialChargeBoxId={data.initialChargeBoxId}
                />
              )
              : null}

            {data.scanLoginEnabled && data.magicLinkEnabled
              ? (
                <div
                  class="relative flex items-center"
                  role="separator"
                  aria-orientation="horizontal"
                >
                  <span class="flex-1 h-px bg-border" />
                  <span class="px-3 text-xs uppercase tracking-wide text-muted-foreground">
                    or
                  </span>
                  <span class="flex-1 h-px bg-border" />
                </div>
              )
              : null}

            {data.magicLinkEnabled
              ? <CustomerLoginForm defaultEmail={data.defaultEmail} />
              : null}
          </div>
        </BlurFade>

        <BlurFade delay={0.3} duration={0.4} direction="up">
          <p class="text-xs text-center text-muted-foreground mt-6">
            Need help?{" "}
            <a
              href={`mailto:${data.operatorEmail}`}
              class="text-primary underline-offset-4 hover:underline"
            >
              Contact your operator
            </a>
          </p>
        </BlurFade>
      </div>
    </div>
  );
});
