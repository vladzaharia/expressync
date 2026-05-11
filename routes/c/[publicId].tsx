/**
 * GET /c/{publicId}
 *
 * Public charger landing page — the URL printed on every QR / NFC
 * sticker we affix to a charger (managed AND unmanaged). The page
 * renders identically for both kinds; individual sections evaluate
 * their own gates on `managementMode` so we never branch on the
 * page template itself.
 *
 * Modelled on the iOS `ChargerDetailView`:
 *   - Status pill + name + location
 *   - Hero artwork (charger glyph + cable U + connector glyph + kW
 *     label) — see `components/public/PublicChargerHero.tsx`
 *   - For managed chargers: two action cards (mobile + NFC) with an
 *     "or" divider. The "Open in app" button is just a link to the
 *     same URL — Apple's Universal Link routing hands it to the app
 *     when installed; otherwise the page stays as-is. We never link
 *     to the App Store from here.
 *   - For unmanaged chargers (Tesla Wall Connectors, etc.): a single
 *     "Plug in. Charge. Free." card mirroring the iOS dumb-charger
 *     instructions.
 *
 * The NFC / QR mechanics are NOT mentioned in the customer copy —
 * they're plumbing that gets the right charger into the app and
 * aren't actions the customer takes themselves.
 *
 * Routing precedence (first match wins):
 *   1. iOS app installed → universal link intercepts via the `/c/*`
 *      AASA component; this handler is never reached.
 *   2. Logged-in admin → 302 to `/admin/chargers/<chargeBoxId>` on
 *      the admin host so admins land on the management view rather
 *      than the customer-facing one.
 *   3. Everyone else → renders this page.
 *
 * Surface: PUBLIC + customer-only (`/c/` registered in
 * `route-classifier.ts`). Stickers always carry
 * `https://example.com/c/<publicId>`; the admin host 404s any
 * accidental request.
 *
 * 404 policy: indistinguishable for "not found", "deactivated", and
 * "doesn't exist" — the public namespace mustn't leak fleet
 * enumeration.
 */

import { eq } from "drizzle-orm";
import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import { chargers } from "../../src/db/schema.ts";
import { PublicShell } from "../../components/public/PublicShell.tsx";
import { PublicChargerHero } from "../../components/public/PublicChargerHero.tsx";
import { PublicIdDisplay } from "../../components/shared/PublicIdDisplay.tsx";
import { isValidPublicId } from "../../src/lib/utils/public-id.ts";
import { getPrimaryConnectorSpec } from "../../src/services/charger-connectors.service.ts";
import type { FormFactor } from "../../src/lib/types/steve.ts";
import type { ConnectorType } from "../../components/brand/connectors/index.ts";

type Status = "available" | "charging" | "offline" | "unknown";

type LoaderData =
  | {
    found: true;
    publicId: string;
    friendlyName: string;
    locationDescription: string | null;
    isUnmanaged: boolean;
    isDeactivated: boolean;
    hasScanner: boolean;
    formFactor: FormFactor;
    connectorType: ConnectorType | null;
    maxKw: number | null;
    status: Status;
    appUrl: string;
  }
  | { found: false };

const ADMIN_HOST = "manage.example.com";

function deriveStatus(
  isUnmanaged: boolean,
  lastStatus: string | null,
  lastStatusAt: Date | null,
): Status {
  if (isUnmanaged) return "unknown";
  if (!lastStatusAt || Date.now() - lastStatusAt.getTime() > 90_000) {
    return "offline";
  }
  switch ((lastStatus ?? "").toLowerCase()) {
    case "available":
    case "preparing":
    case "finishing":
      return "available";
    case "charging":
      return "charging";
    default:
      return "offline";
  }
}

export const handler = define.handlers({
  async GET(ctx) {
    const publicId = ctx.params.publicId;
    if (!publicId || !isValidPublicId(publicId)) {
      return { data: { found: false } satisfies LoaderData };
    }

    const [row] = await db
      .select()
      .from(chargers)
      .where(eq(chargers.publicId, publicId))
      .limit(1);

    if (!row) {
      return { data: { found: false } satisfies LoaderData };
    }

    if (ctx.state.user?.role === "admin") {
      const target = `https://${ADMIN_HOST}/admin/chargers/${
        encodeURIComponent(row.chargeBoxId)
      }`;
      return new Response(null, {
        status: 302,
        headers: { Location: target },
      });
    }

    const isUnmanaged = row.managementMode === "unmanaged";
    const isDeactivated = row.deactivatedAt !== null;

    const appUrl = `https://example.com/c/${row.publicId}`;

    // Apple Smart App Banner — set the app-argument to the canonical
    // public URL so iOS Safari shows "Open in ExpresScan" and the
    // app receives this exact URL on launch after install. Skipped
    // for retired chargers (no point installing the app to interact
    // with a charger that's gone).
    if (!isDeactivated) {
      ctx.state.appBannerArgument = appUrl;
    }

    const spec = await getPrimaryConnectorSpec(row.chargeBoxId);
    const ct = spec.connectorType;
    const connectorType =
      (["ccs", "j1772", "nacs", "chademo", "type2"] as const).includes(
          ct as ConnectorType,
        )
        ? (ct as ConnectorType)
        : null;

    const maxKw = spec.maxKw;

    // The `scanner` capability on a charger row indicates a built-in
    // RFID/NFC reader — mirrors the iOS `entry.capabilities?.contains("scanner")`
    // gate on the "Tap your card" hint.
    const hasScanner = Array.isArray(row.capabilities) &&
      row.capabilities.includes("scanner");

    return {
      data: {
        found: true,
        publicId: row.publicId,
        friendlyName: row.friendlyName ?? row.chargeBoxId,
        locationDescription: row.locationDescription,
        isUnmanaged,
        isDeactivated,
        hasScanner,
        formFactor: (row.formFactor ?? "wallbox") as FormFactor,
        connectorType,
        maxKw,
        status: deriveStatus(isUnmanaged, row.lastStatus, row.lastStatusAt),
        appUrl,
      } satisfies LoaderData,
    };
  },
});

export default define.page<typeof handler>(function ChargerLanding({ data }) {
  if (!data.found) return <NotFoundLanding />;
  if (data.isDeactivated) return <DeactivatedLanding />;

  return (
    <PublicShell
      footerLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      {
        /* Header row: status pill on the left, the charger's public ID
          on the right. The ID is read-only — used by an attendant or
          customer to confirm "yes, this is the charger I'm at" by
          eyeballing the value against the sticker. Not clickable, no
          QR popover here. */
      }
      <div class="flex flex-wrap items-start justify-between gap-3">
        <HeaderRow status={data.status} isUnmanaged={data.isUnmanaged} />
        <div aria-label={`Charger ID ${data.publicId}`}>
          <PublicIdDisplay publicId={data.publicId} size="md" />
        </div>
      </div>

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

      <div class="mt-8">
        <PublicChargerHero
          formFactor={data.formFactor}
          connectorType={data.connectorType}
          maxKw={data.maxKw}
          status={data.status}
        />
      </div>

      {data.isUnmanaged ? <PlugInCard /> : (
        <ManagedActions
          appUrl={data.appUrl}
          hasScanner={data.hasScanner}
        />
      )}

      <p class="mt-10 text-center text-xs text-muted-foreground">
        Need help?{" "}
        <a
          class="underline-offset-2 hover:underline"
          href="mailto:support@example.com"
        >
          support@example.com
        </a>
      </p>
    </PublicShell>
  );
});

// -------------------------------------------------------------------
// Status / header
// -------------------------------------------------------------------

function HeaderRow(
  { status, isUnmanaged }: { status: Status; isUnmanaged: boolean },
) {
  return (
    <div class="flex flex-wrap items-center gap-3">
      {isUnmanaged
        ? (
          <span class="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <BoltIcon class="h-4 w-4" />
            Free charging
          </span>
        )
        : <StatusPill status={status} />}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; tone: string }> = {
    available: {
      label: "Available",
      tone:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    charging: {
      label: "In use",
      tone:
        "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    offline: {
      label: "Offline",
      tone:
        "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    },
    unknown: {
      label: "Unknown",
      tone: "border-border bg-muted/40 text-muted-foreground",
    },
  };
  const { label, tone } = map[status];
  return (
    <span
      class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

// -------------------------------------------------------------------
// Action cards — managed
// -------------------------------------------------------------------

function ManagedActions(
  { appUrl, hasScanner }: { appUrl: string; hasScanner: boolean },
) {
  return (
    <div class="mt-8 flex flex-col gap-4">
      <MobileCard appUrl={appUrl} />
      {hasScanner && (
        <>
          <OrDivider />
          <TapCardCard />
        </>
      )}
    </div>
  );
}

function MobileCard({ appUrl }: { appUrl: string }) {
  return (
    <section
      class="rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-6"
      aria-labelledby="mobile-card-heading"
    >
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <PhoneIcon class="h-5 w-5" />
        </span>
        <h2 id="mobile-card-heading" class="text-lg font-semibold">
          Use the app
        </h2>
      </div>
      <p class="mt-3 text-base text-foreground">
        Open ExpresScan and start charging from your phone.
      </p>
      <div class="mt-4">
        <a
          href={appUrl}
          // Universal Link: iOS hands this off to ExpresScan when
          // installed, otherwise the same page re-renders. We don't
          // need the App Store fallback here — first-time users see
          // the page they're already on, which is helpful in itself.
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-base font-semibold text-white shadow-sm hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 transition-colors"
        >
          <BoltIcon class="h-4 w-4" />
          Open in app
        </a>
      </div>
    </section>
  );
}

function TapCardCard() {
  return (
    <section
      class="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] p-6"
      aria-labelledby="tap-card-heading"
    >
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
          <CardIcon class="h-5 w-5" />
        </span>
        <h2 id="tap-card-heading" class="text-lg font-semibold">
          Tap your card
        </h2>
      </div>
      <p class="mt-3 text-base text-foreground">
        This charger reads RFID cards — tap one to start charging without using
        the app.
      </p>
    </section>
  );
}

function OrDivider() {
  return (
    <div
      class="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      aria-hidden="true"
    >
      <span class="h-px flex-1 bg-border" />
      <span>or</span>
      <span class="h-px flex-1 bg-border" />
    </div>
  );
}

// -------------------------------------------------------------------
// Unmanaged "free" card
// -------------------------------------------------------------------

function PlugInCard() {
  const steps = [
    "Plug in your cable.",
    "Your car negotiates power automatically.",
    "Unplug when you're done.",
  ];
  return (
    <section
      class="mt-8 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-6"
      aria-labelledby="plug-in-heading"
    >
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <PlugIcon class="h-5 w-5" />
        </span>
        <h2 id="plug-in-heading" class="text-lg font-semibold">
          Plug in. Charge. Free.
        </h2>
      </div>
      <ol class="mt-4 list-decimal space-y-2 pl-6 text-base text-foreground">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </section>
  );
}

// -------------------------------------------------------------------
// Error states
// -------------------------------------------------------------------

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
          href="mailto:support@example.com"
        >
          support@example.com
        </a>{" "}
        and we'll sort you out.
      </p>
    </PublicShell>
  );
}

function DeactivatedLanding() {
  return (
    <PublicShell
      footerLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      <span class="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm font-medium text-amber-600 dark:text-amber-400">
        Retired
      </span>
      <h1 class="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        This charger has been retired
      </h1>
      <p class="mt-3 max-w-prose text-base text-muted-foreground">
        The sticker you scanned is no longer in service. If you think this is a
        mistake, please contact us at{" "}
        <a
          class="underline-offset-2 hover:underline"
          href="mailto:support@example.com"
        >
          support@example.com
        </a>.
      </p>
    </PublicShell>
  );
}

// -------------------------------------------------------------------
// Inline icons (matches the page's visual language without dragging
// in a bigger icon dependency)
// -------------------------------------------------------------------

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

function PhoneIcon({ class: cls }: { class?: string }) {
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
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function CardIcon({ class: cls }: { class?: string }) {
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
      <rect x="2" y="6" width="20" height="13" rx="2" ry="2" />
      <line x1="2" y1="11" x2="22" y2="11" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  );
}
