/**
 * GET /handoff/admin (customer host)
 *
 * Interstitial shown when a customer-host visitor needs to reach the
 * admin portal — typically because they signed in as an admin or
 * because they explicitly chose "Sign in to my admin account" from the
 * user menu.
 *
 * Loader behaviour:
 *   - Not signed in at all → 302 to `/login` on this host.
 *   - Has any device session whose user.role === "admin" → server-side
 *     setActiveSession, then 302 to ${ADMIN_BASE_URL}/. The Set-Cookie
 *     headers from setActive are forwarded on the redirect, so the
 *     destination origin already sees the right active session.
 *   - Otherwise → render the picker. The user can sign in to an admin
 *     account or stay on the customer portal.
 *
 * The middleware skips its surface-vs-role enforcement on /handoff/* so
 * we don't loop here.
 */

import { define } from "../../utils.ts";
import { config } from "../../src/lib/config.ts";
import {
  autoSwitchOrNull,
  destinationOrigin,
  type HandoffRow,
  listHandoffSessions,
} from "../../src/lib/handoff.ts";
import { ExpressChargeBrand } from "../../components/brand/ExpressChargeBrand.tsx";
import AccountList from "../../islands/auth/AccountList.tsx";

interface HandoffData {
  desired: "admin";
  destination: string;
  hasMatching: false;
  rowCount: number;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login" },
      });
    }

    const rows = await listHandoffSessions(ctx.req.headers);
    const target = `${
      destinationOrigin("admin", config.CUSTOMER_BASE_URL, config.ADMIN_BASE_URL)
    }/`;

    const auto = await autoSwitchOrNull(rows, "admin", ctx.req.headers, target);
    if (auto) return auto;

    return {
      data: {
        desired: "admin",
        destination: target,
        hasMatching: false,
        rowCount: rows.length,
      } satisfies HandoffData,
    };
  },
});

export default define.page<typeof handler>(function HandoffAdminPage({ data }) {
  return <HandoffPicker data={data} />;
});

function HandoffPicker({ data }: { data: HandoffData }) {
  return (
    <div class="min-h-screen flex items-center justify-center bg-background px-4">
      <div class="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div class="flex justify-center mb-5">
          <ExpressChargeBrand variant="login" />
        </div>
        <h1 class="text-xl font-semibold text-center">
          Looking for the admin portal?
        </h1>
        <p class="mt-2 text-sm text-center text-muted-foreground">
          You're signed in to your customer account on this device. Sign in
          to your admin account to continue, or stay on the customer
          portal.
        </p>

        {data.rowCount > 0 && (
          <div class="mt-5 rounded-md border bg-background p-2">
            <p class="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Signed in on this device
            </p>
            <AccountList allowRevoke={false} />
          </div>
        )}

        <div class="mt-5 flex flex-col gap-2">
          <a
            href={`${data.destination}login`}
            class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in to your admin account
          </a>
          <a
            href="/"
            class="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Stay on the customer portal
          </a>
        </div>
      </div>
    </div>
  );
}
