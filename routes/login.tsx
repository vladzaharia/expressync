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
import { isEmailEnabled } from "../src/lib/email.ts";
import { PolarisExpressBrand } from "../components/brand/PolarisExpressBrand.tsx";
import { Particles } from "../components/magicui/particles.tsx";
import { GridPattern } from "../components/magicui/grid-pattern.tsx";
import { ShineBorder } from "../components/magicui/shine-border.tsx";
import { BlurFade } from "../components/magicui/blur-fade.tsx";
import CustomerLoginWizard from "../islands/customer/CustomerLoginWizard.tsx";

interface CustomerLoginData {
  operatorEmail: string;
  scanLoginEnabled: boolean;
  magicLinkEnabled: boolean;
  autoOpenScan: boolean;
  initialChargeBoxId: string | null;
  defaultEmail: string;
  adminLoginUrl: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const scanParam = url.searchParams.get("scan");
    const chargerParam = url.searchParams.get("chargeBoxId");
    const emailParam = url.searchParams.get("email") ?? "";

    // Scan-to-login only makes sense when at least one charger has been
    // heard from in the last 10 minutes. Otherwise a tap-to-scan CTA fires
    // into the void.
    let hasOnlineCharger = false;
    try {
      const { db } = await import("../src/db/index.ts");
      const schema = await import("../src/db/schema.ts");
      const { gte, sql } = await import("drizzle-orm");
      const cutoff = new Date(Date.now() - 10 * 60 * 1000);
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(schema.chargersCache)
        .where(gte(schema.chargersCache.lastSeenAt, cutoff));
      hasOnlineCharger = Number(row?.c ?? 0) > 0;
    } catch {
      hasOnlineCharger = false;
    }

    return {
      data: {
        operatorEmail: config.OPERATOR_CONTACT_EMAIL,
        // Scan only renders when at least one charger is online — otherwise
        // the CTA is a dead end (data-driven, not a feature flag).
        scanLoginEnabled: hasOnlineCharger,
        // Hide the magic-link UI when the email worker isn't configured.
        // Without it, customers would submit "email me a link" → see
        // "check your email" → wait forever for an email that can never
        // be sent. (Capability detection, not a feature flag.)
        magicLinkEnabled: isEmailEnabled(),
        autoOpenScan: scanParam === "1",
        initialChargeBoxId: chargerParam,
        defaultEmail: emailParam,
        adminLoginUrl: `${config.ADMIN_BASE_URL}/login`,
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
              <PolarisExpressBrand variant="login" showParticles />
            </div>
          </div>
        </BlurFade>

        <BlurFade delay={0.2} duration={0.5} direction="up">
          <div class="relative">
            <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
              <div class="space-y-5 p-5 sm:p-6">
                {data.scanLoginEnabled || data.magicLinkEnabled
                  ? (
                    <CustomerLoginWizard
                      scanEnabled={data.scanLoginEnabled}
                      emailEnabled={data.magicLinkEnabled}
                      autoOpenScan={data.autoOpenScan}
                      initialChargeBoxId={data.initialChargeBoxId}
                      defaultEmail={data.defaultEmail}
                    />
                  )
                  : (
                    <div class="text-center text-sm text-muted-foreground py-2">
                      <p class="font-medium text-foreground">
                        No sign-in methods are available right now.
                      </p>
                      <p class="mt-1">
                        Please contact your operator for assistance.
                      </p>
                    </div>
                  )}
              </div>
            </ShineBorder>
            <a
              href={data.adminLoginUrl}
              class="absolute right-4 top-0 z-20 -translate-y-1/2 inline-flex items-center gap-1 rounded-full border border-slate-500/40 bg-background px-3 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-muted hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-200"
            >
              Admin login →
            </a>
          </div>
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
