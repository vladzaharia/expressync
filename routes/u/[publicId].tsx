/**
 * GET /u/{publicId} — user-card sticker fallback page.
 *
 * Reached only when:
 *   - The iOS Camera resolved the QR but ExpresScan was not installed
 *     (universal-link fell through to Safari), or
 *   - A non-iOS browser opened the URL.
 *
 * iPhones with ExpresScan installed bypass this page entirely — AASA
 * routes the URL to ExpresScan via `.onContinueUserActivity` and the
 * app posts straight to `/api/auth/qr-sign-in`.
 *
 * Surface: PUBLIC + customer-only (registered in route-classifier).
 *
 * 404 policy: indistinguishable for "not found", "not a customer", and
 * "doesn't exist" — the public namespace mustn't leak user enumeration.
 */

import { eq } from "drizzle-orm";
import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import { users } from "../../src/db/schema.ts";
import { PublicShell } from "../../components/public/PublicShell.tsx";
import { PublicIdDisplay } from "../../components/shared/PublicIdDisplay.tsx";
import { isValidPublicId } from "../../src/lib/utils/public-id.ts";

const SUPPORT_EMAIL = "support@example.com";

type LoaderData =
  | { found: true; publicId: string; displayName: string }
  | { found: false };

export const handler = define.handlers({
  async GET(ctx) {
    const publicId = ctx.params.publicId;
    if (!publicId || !isValidPublicId(publicId)) {
      return { data: { found: false } satisfies LoaderData };
    }

    const [row] = await db
      .select({
        publicId: users.publicId,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(eq(users.publicId, publicId))
      .limit(1);

    if (!row || row.role !== "customer") {
      return { data: { found: false } satisfies LoaderData };
    }

    return {
      data: {
        found: true,
        publicId: row.publicId,
        displayName: row.name?.trim() || row.email || "your account",
      } satisfies LoaderData,
    };
  },
});

export default define.page<typeof handler>(function UserSignInLanding(
  { data },
) {
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
      <span class="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-sm font-medium text-cyan-600 dark:text-cyan-400">
        Sign in
      </span>
      <h1 class="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        Welcome back, {data.displayName}
      </h1>

      <div class="mt-6">
        <PublicIdDisplay publicId={data.publicId} size="md" />
      </div>

      <section class="mt-8 rounded-xl border bg-card p-6">
        <h2 class="text-base font-semibold">Get the ExpresScan app</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Your charge card opens ExpresScan directly when you scan it with your
          iPhone Camera. We're putting the app on the App Store — download it,
          then scan your card again to sign in.
        </p>
        <div class="mt-4">
          <span class="inline-flex h-10 items-center justify-center rounded-md border bg-muted px-4 text-sm text-muted-foreground">
            App Store — Coming soon
          </span>
        </div>
      </section>

      <section class="mt-6 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-6">
        <h2 class="text-base font-semibold">After you install</h2>
        <ol class="mt-3 list-decimal space-y-2 pl-6 text-sm text-foreground">
          <li>Open the iPhone Camera app.</li>
          <li>Point it at the QR on your card.</li>
          <li>
            Tap the banner that says <em>Open in ExpresScan</em>.
          </li>
        </ol>
        <p class="mt-3 text-sm text-muted-foreground">
          You can also open ExpresScan directly and choose{" "}
          <em>Sign in by code</em>, then enter the eight-character code above.
        </p>
      </section>

      <p class="mt-10 text-center text-xs text-muted-foreground">
        Need help?{" "}
        <a
          class="underline-offset-2 hover:underline"
          href={`mailto:${SUPPORT_EMAIL}`}
        >
          {SUPPORT_EMAIL}
        </a>
      </p>
    </PublicShell>
  );
});

function NotFoundLanding() {
  return (
    <PublicShell
      footerLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      <span class="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
        Unrecognised code
      </span>
      <h1 class="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        We don't recognise this code
      </h1>
      <p class="mt-3 max-w-prose text-base text-muted-foreground">
        Check that the QR on your card isn't damaged or peeled, then try
        scanning again. If the problem persists, drop us a line at{" "}
        <a
          class="underline-offset-2 hover:underline"
          href={`mailto:${SUPPORT_EMAIL}`}
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        and we'll sort you out.
      </p>
    </PublicShell>
  );
}
