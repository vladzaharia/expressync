/**
 * Reservations index — calendar + list toggle.
 *
 * Server loads the next ~4 weeks of non-terminal reservations; the
 * `ReservationCalendar` island takes over rendering + view-mode toggle.
 */

import { define } from "../../../utils.ts";
import { and, asc, gte, inArray } from "drizzle-orm";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import type { ReservationRowDTO } from "../../../src/db/schema.ts";
import { toReservationRowDTO } from "../../../src/services/reservation.service.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { CHROME_SIZE } from "../../../components/AppSidebar.tsx";
import { Plus } from "lucide-preact";
import ReservationCalendar from "../../../islands/reservations/ReservationCalendar.tsx";
import { logger } from "../../../src/lib/utils/logger.ts";

interface ReservationsIndexData {
  reservations: ReservationRowDTO[];
  errored: boolean;
}

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      const cutoffStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await db
        .select()
        .from(schema.reservations)
        .where(
          and(
            gte(schema.reservations.endAt, cutoffStart),
            inArray(schema.reservations.status, [
              "pending",
              "confirmed",
              "active",
              "conflicted",
              "completed",
            ]),
          ),
        )
        .orderBy(asc(schema.reservations.startAt))
        .limit(300);
      return {
        data: {
          reservations: rows.map(toReservationRowDTO),
          errored: false,
        } satisfies ReservationsIndexData,
      };
    } catch (error) {
      logger.error(
        "Reservations",
        "Failed to load reservations list",
        error as Error,
      );
      return {
        data: {
          reservations: [],
          errored: true,
        } satisfies ReservationsIndexData,
      };
    }
  },
});

function NewAction() {
  return (
    <a
      href="/reservations/new"
      class="flex items-center justify-center gap-2 px-4 transition-colors hover:bg-muted/40"
      style={{ height: CHROME_SIZE }}
    >
      <Plus class="size-5" />
      <span class="text-sm font-medium">New reservation</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function ReservationsIndexPage({ data, url, state }) {
    const count = data.reservations.length;
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="indigo"
        actions={<NewAction />}
      >
        <PageCard
          title="Reservations"
          description={`${count} upcoming / recent reservation${
            count !== 1 ? "s" : ""
          }`}
          colorScheme="indigo"
        >
          {data.errored
            ? (
              <div class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                Couldn't load reservations — try again in a moment.
              </div>
            )
            : <ReservationCalendar reservations={data.reservations} />}
        </PageCard>
      </SidebarLayout>
    );
  },
);
