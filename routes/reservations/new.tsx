/**
 * New reservation — wizard entrypoint.
 *
 * Loader fetches the chargers roster (from `chargers_cache`) plus the StEvE
 * OCPP tag list (best-effort). The wizard island takes over from there.
 */

import { define } from "../../utils.ts";
import { desc } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { BackAction } from "../../components/shared/BackAction.tsx";
import ReservationWizard, {
  type WizardChargerOption,
  type WizardTagOption,
} from "../../islands/reservations/ReservationWizard.tsx";
import { steveClient } from "../../src/lib/steve-client.ts";
import { logger } from "../../src/lib/utils/logger.ts";

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
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const qs = url.searchParams;

    // Chargers (from the sticky cache). We don't know exact connector counts
    // from the cache, so default to [0] (charger-wide) unless StEvE exposes
    // more. Downstream code tolerates this.
    let chargers: WizardChargerOption[] = [];
    try {
      const rows = await db
        .select()
        .from(schema.chargersCache)
        .orderBy(desc(schema.chargersCache.lastSeenAt));
      chargers = rows.map((r) => ({
        chargeBoxId: r.chargeBoxId,
        friendlyName: r.friendlyName,
        // The cache doesn't carry connector metadata, so treat every charger
        // as "charger-wide reservable" unless/until someone wires it through.
        connectorCount: 1,
        connectorIds: [0],
        lastStatus: r.lastStatus,
      }));
    } catch (error) {
      logger.error(
        "Reservations",
        "Failed to load chargers_cache for wizard",
        error as Error,
      );
    }

    // Tags (from StEvE). Best-effort — empty array if StEvE is unreachable.
    let tags: WizardTagOption[] = [];
    try {
      const steveTags = await steveClient.getOcppTags();
      // Join to user_mappings so we can prefill lagoSubscriptionExternalId.
      const mappings = await db.select().from(schema.userMappings);
      const mappingByPk = new Map(mappings.map((m) => [m.steveOcppTagPk, m]));
      tags = steveTags.map((t) => {
        const m = mappingByPk.get(t.ocppTagPk);
        return {
          ocppTagPk: t.ocppTagPk,
          idTag: t.idTag,
          displayName: m?.displayName ?? null,
          lagoSubscriptionExternalId: m?.lagoSubscriptionExternalId ?? null,
        } satisfies WizardTagOption;
      });
    } catch (error) {
      logger.error(
        "Reservations",
        "Failed to fetch OCPP tags for wizard",
        error as Error,
      );
    }

    const initialChargeBox = qs.get("chargeBoxId");
    const initialConnectorRaw = qs.get("connectorId");
    const initialTagPkRaw = qs.get("ocppTagPk") ?? qs.get("tagPk");
    const initialStart = qs.get("start");
    const initialDurationRaw = qs.get("duration");

    return {
      data: {
        chargers,
        tags,
        initial: {
          chargeBoxId: initialChargeBox,
          connectorId: initialConnectorRaw !== null
            ? parseInt(initialConnectorRaw, 10)
            : null,
          ocppTagPk: initialTagPkRaw !== null
            ? parseInt(initialTagPkRaw, 10)
            : null,
          startAtIso: initialStart,
          durationMinutes: initialDurationRaw !== null
            ? parseInt(initialDurationRaw, 10)
            : null,
        },
      } satisfies NewReservationPageData,
    };
  },
});

export default define.page<typeof handler>(
  function NewReservationPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="indigo"
        actions={
          <BackAction href="/reservations" className="hover:bg-muted/40" />
        }
      >
        <PageCard
          title="New reservation"
          description="Pick a charger, connector, tag, and time window. Conflicts are detected inline."
          colorScheme="indigo"
        >
          <ReservationWizard
            chargers={data.chargers}
            tags={data.tags}
            initial={data.initial}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);
