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
import { isEmailEnabled } from "../src/lib/email.ts";
import { ExpresSyncBrand } from "../components/brand/ExpresSyncBrand.tsx";
import { Particles } from "../components/magicui/particles.tsx";
import { GridPattern } from "../components/magicui/grid-pattern.tsx";
import { ShineBorder } from "../components/magicui/shine-border.tsx";
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
        // Hide the magic-link UI when (a) the feature flag is off OR
        // (b) the email worker isn't configured. Without (b), customers
        // would submit "email me a link" → see "check your email" → wait
        // forever for an email that can never be sent.
        magicLinkEnabled: FEATURE_MAGIC_LINK && isEmailEnabled(),
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
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Match the admin login chrome 1:1 — particles + grid + gradient. */}
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
              <ExpresSyncBrand variant="login" showParticles />
            </div>
          </div>
        </BlurFade>

        <BlurFade delay={0.2} duration={0.5} direction="up">
          <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
            <div class="space-y-5 p-5 sm:p-6">
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
          </ShineBorder>
        </BlurFade>

        <BlurFade delay={0.35} duration={0.5} direction="up">
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
