/**
 * GET /c/{publicId}
 *
 * Public charger landing page — the URL printed on every QR / NFC
 * sticker we affix to a charger (managed AND unmanaged). The page
 * renders identically for both kinds; individual sections evaluate
 * their own gates on `managementMode` so we never branch on the
 * page template itself.
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
import { chargersCache } from "../../src/db/schema.ts";
import { PublicShell } from "../../components/public/PublicShell.tsx";
import { PublicIdDisplay } from "../../components/shared/PublicIdDisplay.tsx";
import { ConnectorSpec } from "../../components/shared/ConnectorSpec.tsx";
import {
  DUMB_CHARGER_HEADLINE,
  DUMB_CHARGER_STEPS,
  DUMB_CHARGER_SUPPORT_EMAIL,
  DUMB_CHARGER_TAGLINE,
} from "../../src/lib/content/dumb-charger-instructions.ts";
import { isValidPublicId } from "../../src/lib/utils/public-id.ts";

type Status = "available" | "charging" | "offline" | "unknown";

type LoaderData =
  | {
    found: true;
    publicId: string;
    friendlyName: string;
    locationDescription: string | null;
    isUnmanaged: boolean;
    isDeactivated: boolean;
    connectorType: "ccs" | "j1772" | "nacs" | "chademo" | "type2" | null;
    maxKw: number | null;
    status: Status;
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
      .from(chargersCache)
      .where(eq(chargersCache.publicId, publicId))
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

    const ct = row.connectorTypeOverride;
    const connectorType =
      (["ccs", "j1772", "nacs", "chademo", "type2"] as const).includes(
          ct as "ccs" | "j1772" | "nacs" | "chademo" | "type2",
        )
        ? (ct as "ccs" | "j1772" | "nacs" | "chademo" | "type2")
        : null;

    const maxKw = row.maxKwOverride !== null
      ? Number.isFinite(Number(row.maxKwOverride))
        ? Number(row.maxKwOverride)
        : null
      : null;

    return {
      data: {
        found: true,
        publicId: row.publicId,
        friendlyName: row.friendlyName ?? row.chargeBoxId,
        locationDescription: row.locationDescription,
        isUnmanaged,
        isDeactivated,
        connectorType,
        maxKw,
        status: deriveStatus(isUnmanaged, row.lastStatus, row.lastStatusAt),
      } satisfies LoaderData,
    };
  },
});

export default define.page<typeof handler>(function ChargerLanding({ data }) {
  if (!data.found) {
    return <NotFoundLanding />;
  }
  if (data.isDeactivated) {
    return <DeactivatedLanding />;
  }

  return (
    <PublicShell
      footerLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      <HeaderRow status={data.status} isUnmanaged={data.isUnmanaged} />

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

      <div class="mt-6 flex flex-wrap items-center gap-6">
        <ConnectorSpec
          type={data.connectorType}
          kw={data.maxKw}
          size="lg"
        />
        <PublicIdDisplay publicId={data.publicId} size="md" />
      </div>

      <InstructionsCard isUnmanaged={data.isUnmanaged} />

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

function HeaderRow(
  { status, isUnmanaged }: { status: Status; isUnmanaged: boolean },
) {
  return (
    <div class="flex flex-wrap items-center gap-3">
      {
        /* "Free charging" pill is the unmanaged-charger signal — a
          customer trust marker so they know there's no billing flow. */
      }
      {isUnmanaged && (
        <span class="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <BoltIcon class="h-4 w-4" />
          Free charging
        </span>
      )}
      {
        /* Status pill is gated on managed chargers — unmanaged units
          have no live state to report. */
      }
      {!isUnmanaged && <StatusPill status={status} />}
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

function InstructionsCard({ isUnmanaged }: { isUnmanaged: boolean }) {
  // Same card shell for both kinds — only the headline + body copy
  // swap. Honors the "one page, capability-gated" rule.
  if (isUnmanaged) {
    return (
      <section
        class="mt-8 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-6"
        aria-labelledby="charger-instructions-heading"
      >
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300">
            <PlugIcon class="h-5 w-5" />
          </span>
          <h2
            id="charger-instructions-heading"
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

  return (
    <section
      class="mt-8 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-6"
      aria-labelledby="charger-instructions-heading"
    >
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <PlugIcon class="h-5 w-5" />
        </span>
        <h2
          id="charger-instructions-heading"
          class="text-lg font-semibold"
        >
          Tap the sticker with ExpresScan to start charging
        </h2>
      </div>
      <p class="mt-4 text-base text-foreground">
        Open the ExpresScan iOS app and tap your phone to the sticker on the
        charger. The app handles the rest — start, monitor, and stop your
        session right from your phone.
      </p>
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
          href={`mailto:${DUMB_CHARGER_SUPPORT_EMAIL}`}
        >
          {DUMB_CHARGER_SUPPORT_EMAIL}
        </a>.
      </p>
    </PublicShell>
  );
}

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
