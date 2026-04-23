/**
 * /account — customer Account / Settings page.
 *
 * Polaris Track G3 — single page combining Profile + Preferences + Sign
 * out + Danger zone. SidebarLayout with the customer navigation, page
 * accent = slate.
 *
 * Sections:
 *   1. Profile  — name (editable inline), email (read-only), created at,
 *                 onboarded at
 *   2. Preferences — theme toggle (light / dark / system); language is
 *                    deferred per the plan
 *   3. Sign out — POST /api/auth/sign-out → redirect to /login
 *   4. Account (danger zone) — placeholder; wire to admin contact
 *
 * Inactive accounts get a banner at the top reminding them their account
 * is in view-only mode.
 */

import { define } from "../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
import { MetricTile } from "../../components/shared/MetricTile.tsx";
import { Button } from "../../components/ui/button.tsx";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import { config } from "../../src/lib/config.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import {
  AlertTriangle,
  Calendar,
  Mail,
  Settings,
  Shield,
  ShieldOff,
  User,
} from "lucide-preact";
import CustomerProfileForm from "../../islands/customer/CustomerProfileForm.tsx";
import CustomerSignOutButton from "../../islands/customer/CustomerSignOutButton.tsx";
import CustomerThemeToggle from "../../islands/customer/CustomerThemeToggle.tsx";

const log = logger.child("CustomerAccountPage");

interface AccountPageData {
  profile: {
    id: string;
    name: string | null;
    /** Null for customers auto-provisioned from emailless Lago records. */
    email: string | null;
    createdAtIso: string | null;
    onboardedAtIso: string | null;
  } | null;
  isActive: boolean;
  operatorEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return {
        data: {
          profile: null,
          isActive: false,
          operatorEmail: config.OPERATOR_CONTACT_EMAIL,
        } satisfies AccountPageData,
      };
    }

    const targetUserId = ctx.state.actingAs ?? ctx.state.user.id;
    const scope = await resolveCustomerScope(ctx);

    try {
      const [user] = await db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          createdAt: schema.users.createdAt,
          onboardedAt: schema.users.onboardedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, targetUserId))
        .limit(1);

      if (!user) {
        return {
          data: {
            profile: null,
            isActive: scope.isActive,
            operatorEmail: config.OPERATOR_CONTACT_EMAIL,
          } satisfies AccountPageData,
        };
      }

      return {
        data: {
          profile: {
            id: user.id,
            name: user.name ?? null,
            email: user.email,
            createdAtIso: user.createdAt ? user.createdAt.toISOString() : null,
            onboardedAtIso: user.onboardedAt
              ? user.onboardedAt.toISOString()
              : null,
          },
          isActive: scope.isActive,
          operatorEmail: config.OPERATOR_CONTACT_EMAIL,
        } satisfies AccountPageData,
      };
    } catch (err) {
      log.error("Failed to load account page", err as Error);
      return {
        data: {
          profile: null,
          isActive: scope.isActive,
          operatorEmail: config.OPERATOR_CONTACT_EMAIL,
        } satisfies AccountPageData,
      };
    }
  },
});

function InactiveAccountBanner() {
  return (
    <div
      role="status"
      class="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      <ShieldOff class="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <p class="font-medium">Account in view-only mode</p>
        <p class="text-xs mt-0.5">
          Your account doesn't have any active cards right now. You can still
          view past sessions and invoices. Contact your operator to re-link a
          card.
        </p>
      </div>
    </div>
  );
}

export default define.page<typeof handler>(
  function CustomerAccountPage({ data, url, state }) {
    const profile = data.profile;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        role="customer"
        accentColor="slate"
      >
        <PageCard
          title="Account"
          description="Profile, preferences, and account controls."
          colorScheme="slate"
        >
          <div class="flex flex-col gap-6">
            {!data.isActive && <InactiveAccountBanner />}

            <SectionCard title="Profile" icon={User} accent="slate">
              {profile
                ? (
                  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <MetricTile
                      icon={User}
                      label="Name"
                      value={<CustomerProfileForm initialName={profile.name} />}
                      accent="slate"
                    />
                    <MetricTile
                      icon={Mail}
                      label="Email"
                      value={profile.email ?? "—"}
                      sublabel={profile.email
                        ? "Contact your operator to change"
                        : "No email on file — contact your operator to add one"}
                      accent="slate"
                    />
                    <MetricTile
                      icon={Calendar}
                      label="Account created"
                      value={formatDate(profile.createdAtIso)}
                      accent="slate"
                    />
                    <MetricTile
                      icon={Shield}
                      label="Onboarded"
                      value={formatDate(profile.onboardedAtIso)}
                      accent="slate"
                    />
                  </div>
                )
                : (
                  <p class="text-sm text-muted-foreground">
                    Couldn't load profile right now. Refresh to try again.
                  </p>
                )}
            </SectionCard>

            <SectionCard
              title="Preferences"
              icon={Settings}
              accent="slate"
            >
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Theme
                  </p>
                  <CustomerThemeToggle />
                </div>
                <p class="text-xs text-muted-foreground">
                  Language and other preferences will land in a follow-up
                  release.
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Sign out" accent="slate">
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm text-muted-foreground">
                  End this session on this device. You can sign back in from the
                  login page.
                </p>
                <CustomerSignOutButton />
              </div>
            </SectionCard>

            <SectionCard
              title="Account"
              icon={AlertTriangle}
              accent="slate"
            >
              <div class="flex flex-col gap-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-4">
                <p class="text-sm font-medium">Delete account</p>
                <p class="text-xs text-muted-foreground">
                  Account deletion is currently handled by your operator.
                  Contact them to start the process — they'll soft-delete your
                  account with a 30-day recovery window.
                </p>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a href={`mailto:${data.operatorEmail}`}>
                      Contact operator to delete account
                    </a>
                  </Button>
                </div>
              </div>
            </SectionCard>
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
