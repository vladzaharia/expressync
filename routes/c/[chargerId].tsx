/**
 * GET /c/{chargerId}
 *
 * Public charger landing page — the URL printed on every NFC + QR
 * sticker we affix to an unmanaged (Tesla Wall Connector etc.) charger.
 *
 * Routing precedence (first match wins):
 *   1. iOS app installed → universal link intercepts via the `/c/*`
 *      AASA component; this handler is never reached.
 *   2. Logged-in admin → 302 to `/admin/devices/<id>` on the admin
 *      host. Admins don't want the public "plug in" view; they want
 *      to manage the charger. (`/admin/devices/<id>` is the canonical
 *      device URL across both scanners and chargers; for chargers it
 *      currently 307s on to `/admin/chargers/<id>` until that rename
 *      consolidation lands.)
 *   3. Everyone else (unauth'd customer, logged-in customer, Android,
 *      desktop, link share) → renders the public landing page.
 *
 * Surface: PUBLIC + customer-only. Stickers always carry
 * `https://example.com/c/<id>` (the customer host); the admin host
 * never serves this page. The route classifier enforces the surface
 * scope so a manage.example.com request 404s rather than rendering
 * the public info shell.
 *
 * 404 policy: indistinguishable for "not found" and "exists but is
 * OCPP". The `/c/` namespace is reserved for unmanaged chargers; any
 * other id renders the same friendly "we don't recognise this code"
 * shell so the namespace can't be used to enumerate the fleet.
 *
 * TODO: extend `_app.tsx` to emit per-page head fragments so we can add
 * `<meta name="apple-itunes-app" content="…">` for the Safari smart
 * banner and OpenGraph/Twitter cards for shared links.
 */

import { eq } from "drizzle-orm";
import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import { chargersCache } from "../../src/db/schema.ts";
import { PublicShell } from "../../components/public/PublicShell.tsx";
import {
  DUMB_CHARGER_HEADLINE,
  DUMB_CHARGER_STEPS,
  DUMB_CHARGER_SUPPORT_EMAIL,
  DUMB_CHARGER_TAGLINE,
} from "../../src/lib/content/dumb-charger-instructions.ts";

type LoaderData =
  | {
    found: true;
    friendlyName: string;
    locationDescription: string | null;
  }
  | { found: false };

/// Admin host the redirect points at. Hard-coded rather than read from
/// an env var so a misconfigured deployment can't silently send admins
/// to localhost. If we ever add a staging admin host this becomes a
/// per-environment constant.
const ADMIN_HOST = "manage.example.com";

export const handler = define.handlers({
  async GET(ctx) {
    const chargerId = ctx.params.chargerId;
    if (!chargerId) {
      return { data: { found: false } satisfies LoaderData };
    }

    // Admin-on-phone fallback: if the iOS app didn't intercept and the
    // user has an admin session, send them to the management surface
    // instead of the customer-facing "just plug in" page. Done before
    // the DB lookup so a non-existent id still redirects predictably
    // to the admin not-found page (which is more useful for support).
    if (ctx.state.user?.role === "admin") {
      // Canonical device URL — `/admin/devices/<id>` covers scanners and
      // chargers alike. For chargers this currently 307s to
      // `/admin/chargers/<id>` until the rename refactor lands; that
      // hop is invisible to the user.
      const target = `https://${ADMIN_HOST}/admin/devices/${
        encodeURIComponent(chargerId)
      }`;
      return new Response(null, {
        status: 302,
        headers: { Location: target },
      });
    }

    const [row] = await db
      .select({
        friendlyName: chargersCache.friendlyName,
        chargeBoxId: chargersCache.chargeBoxId,
        locationDescription: chargersCache.locationDescription,
        managementMode: chargersCache.managementMode,
      })
      .from(chargersCache)
      .where(eq(chargersCache.chargeBoxId, chargerId))
      .limit(1);

    if (!row || row.managementMode !== "unmanaged") {
      return { data: { found: false } satisfies LoaderData };
    }

    return {
      data: {
        found: true,
        friendlyName: row.friendlyName ?? row.chargeBoxId,
        locationDescription: row.locationDescription,
      } satisfies LoaderData,
    };
  },
});

export default define.page<typeof handler>(function ChargerLanding({ data }) {
  if (!data.found) {
    return <NotFoundLanding />;
  }
  return (
    <PublicShell
      footerLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      <FreePill />

      <div class="mt-6">
        <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
          {data.friendlyName}
        </h1>
        {data.locationDescription
          ? (
            <p class="mt-2 text-base text-muted-foreground">
              {data.locationDescription}
            </p>
          )
          : null}
      </div>

      <InstructionsCard />

      <GetTheAppCard />

      <p class="mt-10 text-center text-xs text-muted-foreground">
        Need help?{" "}
        <a
          class="underline-offset-2 hover:underline"
          href={`mailto:${DUMB_CHARGER_SUPPORT_EMAIL}`}
        >
          {DUMB_CHARGER_SUPPORT_EMAIL}
        </a>
      </p>
    </PublicShell>
  );
});

function FreePill() {
  return (
    <span class="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
      <BoltIcon class="h-4 w-4" />
      Free charging
    </span>
  );
}

function InstructionsCard() {
  return (
    <section
      class="mt-8 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-6"
      aria-labelledby="dumb-charger-instructions-heading"
    >
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <PlugIcon class="h-5 w-5" />
        </span>
        <h2
          id="dumb-charger-instructions-heading"
          class="text-lg font-semibold"
        >
          {DUMB_CHARGER_HEADLINE}
        </h2>
      </div>
      <ol class="mt-4 list-decimal space-y-2 pl-6 text-base text-foreground">
        {DUMB_CHARGER_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p class="mt-4 text-sm text-muted-foreground">{DUMB_CHARGER_TAGLINE}</p>
    </section>
  );
}

function GetTheAppCard() {
  return (
    <section class="mt-6 rounded-xl border bg-card p-6">
      <h2 class="text-base font-semibold">
        Get the app for one-tap access to all our chargers
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        ExpresScan opens automatically when you tap a sticker. iOS only for now
        — Android coming soon.
      </p>
      <div class="mt-4">
        <span class="inline-flex h-10 items-center justify-center rounded-md border bg-muted px-4 text-sm text-muted-foreground">
          App Store — Coming soon
        </span>
      </div>
    </section>
  );
}

function NotFoundLanding() {
  return (
    <PublicShell
      footerLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      <span class="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
        Unrecognised charger
      </span>
      <h1 class="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        We don't recognise this code
      </h1>
      <p class="mt-3 max-w-prose text-base text-muted-foreground">
        Check that the sticker on the charger isn't damaged or peeled, then try
        scanning again. If the problem persists, drop us a line at{" "}
        <a
          class="underline-offset-2 hover:underline"
          href={`mailto:${DUMB_CHARGER_SUPPORT_EMAIL}`}
        >
          {DUMB_CHARGER_SUPPORT_EMAIL}
        </a>{" "}
        and we'll sort you out.
      </p>
    </PublicShell>
  );
}

// Inline SVG icons — keeps the public page free of additional JS bundles
// (the lucide-preact import would only land in icons via island
// hydration; on a server-only page, a hand-rolled SVG is lighter).

function BoltIcon({ class: cls }: { class?: string }) {
  return (
    <svg
      class={cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function PlugIcon({ class: cls }: { class?: string }) {
  return (
    <svg
      class={cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22v-5" />
      <path d="M9 7V2" />
      <path d="M15 7V2" />
      <path d="M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
    </svg>
  );
}
