/**
 * GET /auth/scan
 *
 * Polaris Track C — deep-link landing for scan-to-login. QR codes
 * printed on chargers point here; the page nudges the customer to
 * launch the scan modal automatically (via `<AutoRedirect>` island).
 *
 * The actual scan-to-login UI lives in the customer login page island
 * (Track E — `islands/customer/ScanToLogin.tsx`). Until that island
 * lands, this page links the customer to `/login?scan=1` so the login
 * page can detect the intent and open the modal.
 *
 * Lives at `polaris.express/auth/scan` — customer surface only (the
 * route classifier scopes it that way).
 */

import { define } from "../../utils.ts";
import AutoRedirect from "../../islands/AutoRedirect.tsx";

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const chargeBoxId = url.searchParams.get("chargeBoxId");
    return {
      data: {
        chargeBoxId: chargeBoxId ?? null,
      },
    };
  },
});

export default define.page<typeof handler>(function ScanDeepLink({ data }) {
  const target = data.chargeBoxId
    ? `/login?scan=1&chargeBoxId=${encodeURIComponent(data.chargeBoxId)}`
    : `/login?scan=1`;
  return (
    <div class="min-h-screen flex items-center justify-center bg-background">
      <div class="w-full max-w-md p-6 rounded-lg border border-border bg-card text-center">
        <h1 class="text-xl font-semibold mb-2">Tap your card to sign in</h1>
        <p class="text-sm text-muted-foreground mb-6">
          {data.chargeBoxId
            ? `Open the scan-to-sign-in screen on this device for charger ${data.chargeBoxId}.`
            : "Open the scan-to-sign-in screen on this device."}
        </p>
        <a
          href={target}
          class="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
        >
          Continue to sign-in
        </a>
        {
          /* Best-effort auto-redirect; gated on JS so users without it
            still see the manual button. */
        }
        <AutoRedirect href={target} delayMs={800} />
      </div>
    </div>
  );
});
