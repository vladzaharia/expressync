import { desc, eq, gte, sql } from "drizzle-orm";
import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { chargersCache } from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import ChargerCard, {
  type ChargerCardDto,
} from "../../islands/ChargerCard.tsx";
import { ChargersStatStrip } from "../../components/chargers/ChargersStatStrip.tsx";
import { ChargersEmptyState } from "../../components/chargers/ChargersEmptyState.tsx";
import { normalizeStatus } from "../../islands/shared/charger-visuals.ts";
import { config } from "../../src/lib/config.ts";
import { logger } from "../../src/lib/utils/logger.ts";

interface ChargersPageData {
  chargers: ChargerCardDto[];
  errored: boolean;
  totals: {
    online: number;
    offline: number;
    chargingNow: number;
    kwhLast24h: number;
  };
  steveUrl: string;
}

export const handler = define.handlers({
  async GET(_ctx) {
    let chargers: ChargerCardDto[] = [];
    let errored = false;
    let online = 0;
    let offline = 0;
    let chargingNow = 0;
    let kwhLast24h = 0;

    try {
      const rows = await db
        .select()
        .from(chargersCache)
        .orderBy(desc(chargersCache.lastSeenAt));

      chargers = rows.map((r) => ({
        chargeBoxId: r.chargeBoxId,
        chargeBoxPk: r.chargeBoxPk,
        friendlyName: r.friendlyName,
        formFactor: r.formFactor,
        firstSeenAtIso: (r.firstSeenAt ?? new Date()).toISOString(),
        lastSeenAtIso: (r.lastSeenAt ?? new Date()).toISOString(),
        lastStatus: r.lastStatus,
        lastStatusAtIso: r.lastStatusAt ? r.lastStatusAt.toISOString() : null,
      }));

      // Derive online/offline from the same age+uiStatus rules the cards use
      // so the strip never disagrees with the grid.
      for (const c of chargers) {
        const status = normalizeStatus(c.lastStatus, c.lastStatusAtIso, false);
        if (status === "Offline") offline++;
        else online++;
      }
    } catch (error) {
      errored = true;
      logger.error("Chargers", "Failed to load chargers_cache", error as Error);
    }

    // Two cheap DB aggregates — kept in their own try blocks so a single
    // failure doesn't take the whole page down.
    try {
      const [{ openTx }] = await db
        .select({ openTx: sql<number>`COUNT(*)` })
        .from(schema.transactionSyncState)
        .where(eq(schema.transactionSyncState.isFinalized, false));
      chargingNow = Number(openTx) || 0;
    } catch (error) {
      logger.error(
        "Chargers",
        "Failed to count open transactions",
        error as Error,
      );
    }

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [{ kwh }] = await db
        .select({
          kwh: sql<
            number
          >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
        })
        .from(schema.syncedTransactionEvents)
        .where(gte(schema.syncedTransactionEvents.syncedAt, since));
      // Drizzle returns numeric as string — coerce defensively.
      kwhLast24h = Number(kwh) || 0;
    } catch (error) {
      logger.error(
        "Chargers",
        "Failed to sum kWh over last 24h",
        error as Error,
      );
    }

    return {
      data: {
        chargers,
        errored,
        totals: { online, offline, chargingNow, kwhLast24h },
        steveUrl: config.STEVE_BASE_URL,
      } satisfies ChargersPageData,
    };
  },
});

function ChargerGridSkeleton() {
  return (
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          class="h-44 animate-pulse rounded-xl border bg-muted/40"
        />
      ))}
    </div>
  );
}

function InlineFetchError() {
  return (
    <div class="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      Couldn't reach charger cache — showing none.
    </div>
  );
}

export default define.page<typeof handler>(
  function ChargersPage({ data, url, state }) {
    const isAdmin = state.user?.role === "admin";
    const count = data.chargers.length;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="orange"
      >
        <PageCard title="Chargers" colorScheme="orange">
          <ChargersStatStrip totals={data.totals} />

          {data.errored
            ? (
              <>
                <ChargerGridSkeleton />
                <InlineFetchError />
              </>
            )
            : count === 0
            ? <ChargersEmptyState steveUrl={data.steveUrl} />
            : (
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data.chargers.map((c) => (
                  <ChargerCard
                    key={c.chargeBoxId}
                    charger={c}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
            )}
        </PageCard>
      </SidebarLayout>
    );
  },
);
