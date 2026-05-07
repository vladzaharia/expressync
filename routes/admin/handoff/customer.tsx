/**
 * GET /handoff/customer (admin host — served via the /admin path rewrite)
 *
 * Interstitial shown when an admin-host visitor needs to reach the
 * customer portal. Symmetric to `routes/handoff/admin.tsx`. Triggered
 * when a customer-role visitor lands on the admin host (the middleware
 * 302s them here instead of doing a hard cross-host bounce).
 *
 * Loader behaviour mirrors the admin direction:
 *   - Not signed in → 302 to /login on this host.
 *   - Has a device session whose user.role !== "admin" → server-side
 *     setActiveSession + 302 to ${CUSTOMER_BASE_URL}/, with Set-Cookie
 *     headers forwarded.
 *   - Otherwise → render the picker.
 */

import { define } from "../../../utils.ts";
import { config } from "../../../src/lib/config.ts";
import {
  autoSwitchOrNull,
  destinationOrigin,
  listHandoffSessions,
} from "../../../src/lib/handoff.ts";
import { PolarisExpressBrand } from "../../../components/brand/PolarisExpressBrand.tsx";
import AccountList from "../../../islands/auth/AccountList.tsx";

interface HandoffData {
  desired: "customer";
  destination: string;
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
      destinationOrigin(
        "customer",
        config.CUSTOMER_BASE_URL,
        config.ADMIN_BASE_URL,
      )
    }/`;

    const auto = await autoSwitchOrNull(
      rows,
      "customer",
      ctx.req.headers,
      target,
    );
    if (auto) return auto;

    return {
      data: {
        desired: "customer",
        destination: target,
        rowCount: rows.length,
      } satisfies HandoffData,
    };
  },
});

export default define.page<typeof handler>(function HandoffCustomerPage(
  { data },
) {
  return <HandoffPicker data={data} />;
});

function HandoffPicker({ data }: { data: HandoffData }) {
  return (
    <div class="min-h-screen flex items-center justify-center bg-background px-4">
      <div class="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div class="flex justify-center mb-5">
          <PolarisExpressBrand variant="login" />
        </div>
        <h1 class="text-xl font-semibold text-center">
          Looking for the customer portal?
        </h1>
        <p class="mt-2 text-sm text-center text-muted-foreground">
          You're signed in with an admin account on this device. Sign in
          to your customer account to continue, or stay on the admin
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
            Sign in to your customer account
          </a>
          <a
            href="/"
            class="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Stay on the admin portal
          </a>
        </div>
      </div>
    </div>
  );
}
