/**
 * GET /switch (customer host only)
 *
 * App-wide account picker. Shown when the user wants to switch between
 * accounts on this device, or wants to add a new account. Always lives
 * on the customer host — the admin host's user menu links here with an
 * absolute URL.
 *
 * The page renders:
 *   - The list of currently-signed-in device sessions (border style;
 *     reuses `<AccountList />`). Clicking a row activates that session
 *     and routes to its matching surface.
 *   - An "or" divider.
 *   - Two side-by-side CTAs: "Customer login" / "Admin login". Each
 *     links to its login page with a `?back` param so the login pages
 *     can offer a return-to-picker affordance.
 *
 * No auth gate — the picker is reachable signed-out (then it shows just
 * the two login buttons).
 */

import { define } from "../utils.ts";
import { config } from "../src/lib/config.ts";
import { PolarisExpressBrand } from "../components/brand/PolarisExpressBrand.tsx";
import { ShineBorder } from "../components/magicui/shine-border.tsx";
import { BlurFade } from "../components/magicui/blur-fade.tsx";
import { GridPattern } from "../components/magicui/grid-pattern.tsx";
import { Particles } from "../components/magicui/particles.tsx";
import AccountList from "../islands/auth/AccountList.tsx";

interface SwitchData {
  customerLoginUrl: string;
  adminLoginUrl: string;
  pickerUrl: string;
}

export const handler = define.handlers({
  GET() {
    // Both login URLs carry a `back` param pointing back to the
    // canonical customer-host picker. The login routes honour this
    // (relative or matching one of our base URLs only — open-redirect
    // safe).
    const pickerUrl = `${config.CUSTOMER_BASE_URL}/switch`;
    return {
      data: {
        customerLoginUrl: `/login?back=/switch`,
        adminLoginUrl: `${config.ADMIN_BASE_URL}/login?back=${
          encodeURIComponent(pickerUrl)
        }`,
        pickerUrl,
      } satisfies SwitchData,
    };
  },
});

export default define.page<typeof handler>(function SwitchPage({ data }) {
  return (
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-background px-4">
      {/* Match the login chrome 1:1 — particles + grid + gradient. */}
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

      <div class="relative z-10 w-full max-w-md">
        <BlurFade delay={0} duration={0.5} direction="down">
          <div class="flex justify-center mb-8">
            <PolarisExpressBrand variant="login" showParticles />
          </div>
        </BlurFade>

        <BlurFade delay={0.2} duration={0.5} direction="up">
          <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
            <div class="space-y-5 p-5 sm:p-6">
              <div class="space-y-1 text-center">
                <h1 class="text-xl font-semibold">Choose an account</h1>
                <p class="text-sm text-muted-foreground">
                  Pick an existing session or sign in to a new one.
                </p>
              </div>

              {/*
                AccountList renders nothing when there are zero sessions,
                so signed-out visitors see the divider + buttons only.
                The divider is gated on a non-empty list so it doesn't
                float on its own.
              */}
              <AccountList allowRevoke={false} className="min-w-0" />

              <SwitchDivider />

              <div class="grid grid-cols-2 gap-2">
                <a
                  href={data.customerLoginUrl}
                  class="inline-flex items-center justify-center rounded-md border border-primary/40 bg-background px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
                >
                  Customer login
                </a>
                <a
                  href={data.adminLoginUrl}
                  class="inline-flex items-center justify-center rounded-md border border-emerald-500/40 bg-background px-3 py-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-500/5 dark:text-emerald-400"
                >
                  Admin login
                </a>
              </div>
            </div>
          </ShineBorder>
        </BlurFade>
      </div>
    </div>
  );
});

function SwitchDivider() {
  return (
    <div class="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
      <span class="h-px flex-1 bg-border" />
      <span>or</span>
      <span class="h-px flex-1 bg-border" />
    </div>
  );
}
