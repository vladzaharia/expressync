/**
 * /reservations/new — customer reservation wizard.
 *
 * Polaris Track G3 — wraps the existing `ReservationWizard` island with
 * customer-scoped data:
 *
 *   - chargers      — pulled from `chargers_cache` (the friends-and-family
 *                     deployment model assumes every cached charger is
 *                     reachable; per-user charger ACLs are not yet a
 *                     first-class concept). Customers without an active
 *                     scope see an empty list and a friendly explanation.
 *   - tags          — restricted to the caller's `user_mappings` rows.
 *   - submitUrl     — `/api/customer/reservations` (the customer endpoint
 *                     enforces capability + ownership).
 *   - conflictCheckUrl — `/api/customer/reservations` (filtered to the
 *                        caller's tags so the inline overlap check stays
 *                        scoped — admins shouldn't leak via this endpoint).
 *
 * Mobile presentation: when JS detects a `<md` viewport, the page wraps the
 * wizard in a full-screen `Sheet` so it fills the viewport like an app
 * modal. Wider viewports get the standard page layout with a card frame.
 */

import { define } from "../../utils.ts";
import { desc, eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { BackAction } from "../../components/shared/BackAction.tsx";
import { EmptyState } from "../../components/shared/EmptyState.tsx";
import { CalendarClock } from "lucide-preact";
import ReservationWizard, {
  type WizardChargerOption,
  type WizardTagOption,
} from "../../islands/reservations/ReservationWizard.tsx";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import { getCustomerCapabilities } from "../../src/lib/capabilities.ts";
import { logger } from "../../src/lib/utils/logger.ts";

const log = logger.child("CustomerReservationNewPage");

interface NewReservationPageData {
  chargers: WizardChargerOption[];
  tags: WizardTagOption[];
  initial: {
    chargeBoxId: string | null;
    connectorId: number | null;
    ocppTagPk: number | null;
    startAtIso: string | null;
    durationMinutes: number | null;
  };
  /** True when the caller has the `reserve` capability (active scope). */
  canReserve: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const qs = url.searchParams;

    const scope = await resolveCustomerScope(ctx);
    const caps = await getCustomerCapabilities(ctx);
    const canReserve = caps.has("reserve");

    let chargers: WizardChargerOption[] = [];
    let tags: WizardTagOption[] = [];

    if (canReserve) {
      // Chargers from the cache. Same default as admin: assume one
      // charger-wide connector unless connector metadata exists.
      try {
        const rows = await db
          .select()
          .from(schema.chargersCache)
          .orderBy(desc(schema.chargersCache.lastSeenAt));
        chargers = rows.map((r) => ({
          chargeBoxId: r.chargeBoxId,
          friendlyName: r.friendlyName,
          connectorCount: 1,
          connectorIds: [0],
          lastStatus: r.lastStatus,
        }));
      } catch (error) {
        log.error("Failed to load chargers_cache", error as Error);
      }

      // Tags scoped to the customer's own active mappings only. We pull
      // straight from user_mappings (no StEvE roundtrip) so the wizard
      // tags exactly match the cards the customer can see.
      try {
        const rows = await db
          .select({
            steveOcppTagPk: schema.userMappings.steveOcppTagPk,
            steveOcppIdTag: schema.userMappings.steveOcppIdTag,
            displayName: schema.userMappings.displayName,
            lagoSubscriptionExternalId:
              schema.userMappings.lagoSubscriptionExternalId,
            isActive: schema.userMappings.isActive,
          })
          .from(schema.userMappings)
          .where(
            eq(
              schema.userMappings.userId,
              ctx.state.actingAs ?? ctx.state.user?.id ?? "",
            ),
          );
        tags = rows
          .filter((r) => r.isActive)
          .map((r) => ({
            ocppTagPk: r.steveOcppTagPk,
            idTag: r.steveOcppIdTag,
            displayName: r.displayName,
            lagoSubscriptionExternalId: r.lagoSubscriptionExternalId,
          }));
      } catch (error) {
        log.error("Failed to load customer tags", error as Error);
      }
    }

    const initialChargeBox = qs.get("chargeBoxId");
    const initialConnectorRaw = qs.get("connectorId");
    const initialTagPkRaw = qs.get("ocppTagPk") ?? qs.get("tagPk");
    const initialStart = qs.get("start");
    const initialDurationRaw = qs.get("duration");

    // `scope` is not referenced beyond the capability gate; we resolve it
    // here so the request-scoped cache warms for any downstream handlers.
    void scope;

    return {
      data: {
        chargers,
        tags,
        initial: {
          chargeBoxId: initialChargeBox ??
            // Auto-prefill when the customer owns exactly one charger.
            (chargers.length === 1 ? chargers[0].chargeBoxId : null),
          connectorId: initialConnectorRaw !== null
            ? parseInt(initialConnectorRaw, 10)
            : null,
          ocppTagPk: initialTagPkRaw !== null
            ? parseInt(initialTagPkRaw, 10)
            // Auto-prefill when the customer has exactly one tag.
            : (tags.length === 1 ? tags[0].ocppTagPk : null),
          startAtIso: initialStart,
          durationMinutes: initialDurationRaw !== null
            ? parseInt(initialDurationRaw, 10)
            : null,
        },
        canReserve,
      } satisfies NewReservationPageData,
    };
  },
});

export default define.page<typeof handler>(
  function CustomerReservationNewPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        role="customer"
        accentColor="indigo"
        actions={<BackAction href="/reservations" />}
      >
        <PageCard
          title="Reserve a charger"
          description="Pick a window and we'll hold the charger for you."
          colorScheme="indigo"
        >
          {!data.canReserve
            ? (
              <EmptyState
                icon={CalendarClock}
                accent="indigo"
                title="Account not ready for reservations"
                description="Your account doesn't have any active cards. Contact your operator to link a card and unlock reservations."
                primaryAction={{
                  label: "Back to reservations",
                  href: "/reservations",
                }}
              />
            )
            : data.tags.length === 0
            ? (
              <EmptyState
                icon={CalendarClock}
                accent="indigo"
                title="No cards available"
                description="There are no active cards on your account to attach a reservation to."
              />
            )
            : data.chargers.length === 0
            ? (
              <EmptyState
                icon={CalendarClock}
                accent="indigo"
                title="No chargers known yet"
                description="Once your operator brings a charger online, you'll be able to reserve time on it."
              />
            )
            : (
              <ReservationWizard
                chargers={data.chargers}
                tags={data.tags}
                initial={data.initial}
                submitUrl="/api/customer/reservations"
                conflictCheckUrl="/api/customer/reservations"
                redirectPathPrefix="/reservations"
                celebrateOnSuccess
              />
            )}
        </PageCard>
      </SidebarLayout>
    );
  },
);
