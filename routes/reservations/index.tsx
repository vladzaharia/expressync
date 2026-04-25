/**
 * /reservations — customer Reservations landing.
 *
 * Polaris Track G3 — customer-scoped reservation list. SidebarLayout with
 * the customer navigation, page accent = indigo. View toggle (calendar /
 * list) is URL-backed via `?view=`.
 *
 * Loader filters reservations to the caller's owned tags
 * (`steve_ocpp_tag_pk IN scope.ocppTagPks`); empty scope renders the
 * canonical EmptyState. The "+ New" header action is disabled when the
 * customer's account is in the soft-deactivated state (no active mappings)
 * since the API would 403 the create attempt anyway.
 */

import { define } from "../../utils.ts";
import { and, asc, desc, gte, inArray } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import type { ReservationRowDTO } from "../../src/db/schema.ts";
import {
  enrichDtosWithFriendlyNames,
  toReservationRowDTO,
} from "../../src/services/reservation.service.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";
import {
  StatStrip,
  type StatStripItem,
} from "../../components/shared/StatStrip.tsx";
import { EmptyState } from "../../components/shared/EmptyState.tsx";
import { BlurFade } from "../../components/magicui/blur-fade.tsx";
import { CalendarClock, CalendarDays, Plus } from "lucide-preact";
import ReservationCalendar from "../../islands/reservations/ReservationCalendar.tsx";
import CustomerReservationsTable from "../../islands/customer/CustomerReservationsTable.tsx";
import ReservationsViewToggle, {
  type ReservationsView,
} from "../../islands/customer/ReservationsViewToggle.tsx";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import { cn } from "../../src/lib/utils/cn.ts";

const log = logger.child("CustomerReservationsPage");

interface ReservationsPageData {
  reservations: ReservationRowDTO[];
  stats: {
    upcoming: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
  };
  view: ReservationsView;
  isActive: boolean;
  upcomingFilter: boolean;
  hasOwnedTags: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const viewParam = url.searchParams.get("view");
    const view: ReservationsView = viewParam === "list" ? "list" : "calendar";
    const upcomingFilter = url.searchParams.get("upcoming") === "true";

    const scope = await resolveCustomerScope(ctx);
    if (scope.ocppTagPks.length === 0) {
      return {
        data: {
          reservations: [],
          stats: { upcoming: 0, thisWeek: 0, thisMonth: 0, total: 0 },
          view,
          isActive: scope.isActive,
          upcomingFilter,
          hasOwnedTags: false,
        } satisfies ReservationsPageData,
      };
    }

    try {
      const cutoffStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const baseClauses = [
        inArray(schema.reservations.steveOcppTagPk, scope.ocppTagPks),
      ];
      if (upcomingFilter) {
        baseClauses.push(gte(schema.reservations.endAt, new Date()));
      } else {
        baseClauses.push(gte(schema.reservations.endAt, cutoffStart));
      }

      const rows = await db
        .select()
        .from(schema.reservations)
        .where(and(...baseClauses))
        .orderBy(
          upcomingFilter
            ? asc(schema.reservations.startAt)
            : desc(schema.reservations.startAt),
        )
        .limit(300);

      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      let upcoming = 0;
      let thisWeek = 0;
      let thisMonth = 0;
      for (const r of rows) {
        const startMs = r.startAt?.getTime() ?? 0;
        if (startMs >= now) upcoming += 1;
        if (startMs >= now && startMs <= now + oneWeekMs) thisWeek += 1;
        if (startMs >= startOfMonth.getTime()) thisMonth += 1;
      }

      const dtoRows: ReservationRowDTO[] = await enrichDtosWithFriendlyNames(
        rows.map(toReservationRowDTO),
      );

      return {
        data: {
          reservations: dtoRows,
          stats: {
            upcoming,
            thisWeek,
            thisMonth,
            total: rows.length,
          },
          view,
          isActive: scope.isActive,
          upcomingFilter,
          hasOwnedTags: true,
        } satisfies ReservationsPageData,
      };
    } catch (error) {
      log.error("Failed to load customer reservations", error as Error);
      return {
        data: {
          reservations: [],
          stats: { upcoming: 0, thisWeek: 0, thisMonth: 0, total: 0 },
          view,
          isActive: scope.isActive,
          upcomingFilter,
          hasOwnedTags: true,
        } satisfies ReservationsPageData,
      };
    }
  },
});

/**
 * Header action — "+ New reservation". Disabled (with tooltip) when the
 * account is in the soft-deactivated state since the API would 403 the
 * create POST anyway.
 */
function NewReservationAction({ enabled }: { enabled: boolean }) {
  const baseClass =
    "flex items-center justify-center gap-2 px-4 transition-colors";
  if (!enabled) {
    return (
      <span
        title="Reservation creation is disabled for inactive accounts"
        className={cn(baseClass, "text-muted-foreground cursor-not-allowed")}
        style={{ height: CHROME_SIZE }}
        aria-disabled="true"
      >
        <Plus className="size-5" aria-hidden="true" />
        <span className="text-sm font-medium">New reservation</span>
      </span>
    );
  }
  return (
    <a
      href="/reservations/new"
      className={cn(baseClass, "hover:bg-muted/40")}
      style={{ height: CHROME_SIZE }}
    >
      <Plus className="size-5" aria-hidden="true" />
      <span className="text-sm font-medium">New reservation</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function CustomerReservationsIndexPage({ data, url, state }) {
    const stats: StatStripItem[] = [
      {
        key: "upcoming",
        label: "Upcoming",
        value: data.stats.upcoming,
        icon: CalendarClock,
        href: "/reservations?upcoming=true",
        active: data.upcomingFilter,
        disabledWhenZero: true,
      },
      {
        key: "this-week",
        label: "This week",
        value: data.stats.thisWeek,
        icon: CalendarDays,
      },
      {
        key: "this-month",
        label: "This month",
        value: data.stats.thisMonth,
        icon: CalendarDays,
      },
      {
        key: "total",
        label: "Total",
        value: data.stats.total,
        icon: CalendarDays,
        tone: "muted",
      },
    ];

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        role="customer"
        accentColor="indigo"
        actions={<NewReservationAction enabled={data.isActive} />}
      >
        <PageCard
          title="Reservations"
          description={data.upcomingFilter
            ? "Showing upcoming reservations only."
            : "Charging windows you've booked."}
          colorScheme="indigo"
        >
          <div className="flex flex-col gap-6">
            <BlurFade direction="up" duration={0.35}>
              <StatStrip accent="indigo" items={stats} />
            </BlurFade>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <ReservationsViewToggle value={data.view} />
            </div>

            {!data.hasOwnedTags
              ? (
                <EmptyState
                  icon={CalendarClock}
                  accent="indigo"
                  title="No cards linked yet"
                  description="Once your operator links a card to your account, you can reserve charger time here."
                />
              )
              : data.reservations.length === 0
              ? (
                <EmptyState
                  icon={CalendarClock}
                  accent="indigo"
                  title="No reservations to show"
                  description={data.upcomingFilter
                    ? "You don't have any upcoming reservations. Create one below."
                    : "Reserve a charger to lock in a window."}
                  primaryAction={data.isActive
                    ? {
                      label: "+ New reservation",
                      href: "/reservations/new",
                    }
                    : undefined}
                />
              )
              : data.view === "list"
              ? (
                <CustomerReservationsTable
                  reservations={data.reservations}
                  totalCount={data.reservations.length}
                />
              )
              : (
                <ReservationCalendar
                  reservations={data.reservations}
                  defaultView="week"
                />
              )}
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
