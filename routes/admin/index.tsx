/**
 * Admin landing page — operational war-room for ExpresSync.
 *
 * Layout (per CLAUDE.md):
 *   SidebarLayout
 *   └── PageCard (cyan, BorderBeam, GridPattern)  — single page root
 *       ├── DashboardHeaderStrip   (system pulse)
 *       ├── DashboardStatStrip     (interactive KPI cells)
 *       └── 2x2 SectionCard grid:
 *           - Live now            (emerald, BorderBeam while content present)
 *           - Active sync run     (blue, BorderBeam while running)
 *           - Health              (cyan, semantic tone overrides per-row)
 *           - This week           (cyan)
 *
 * SSR pulls a single aggregated overview via `loadDashboardOverview`. SSE
 * islands keep the live-most signals (active sessions count, in-flight sync,
 * fleet pulse) current between polls. The Health card auto-revalidates every
 * 30s so the page stays honest if the operator leaves it open.
 */

import { define } from "@/utils.ts";
import { SidebarLayout } from "@/components/SidebarLayout.tsx";
import { PageCard } from "@/components/PageCard.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { EmptyState } from "@/components/shared/EmptyState.tsx";
import {
  Activity,
  Calendar,
  HeartPulse,
  Layers,
  Link2,
  Tag,
  TrendingUp,
  Zap,
} from "lucide-preact";
import DashboardHeaderStrip from "@/islands/admin/dashboard/DashboardHeaderStrip.tsx";
import DashboardStatStrip from "@/islands/admin/dashboard/DashboardStatStrip.tsx";
import LiveSessionsList from "@/islands/admin/dashboard/LiveSessionsList.tsx";
import SyncRunProgressCard from "@/islands/admin/dashboard/SyncRunProgressCard.tsx";
import HealthSection from "@/islands/admin/dashboard/HealthSection.tsx";
import {
  type DashboardOverview,
  loadDashboardOverview,
} from "@/routes/api/admin/dashboard/overview.ts";

interface DashboardData {
  overview: DashboardOverview;
  isFirstRun: boolean;
}

export const handler = define.handlers({
  async GET(_ctx) {
    const overview = await loadDashboardOverview();
    // First-run heuristic: no chargers ever seen AND no sync runs yet.
    const isFirstRun = overview.pulse.chargersTotal === 0 &&
      overview.weekly.syncRunsWeek === 0;
    return { data: { overview, isFirstRun } satisfies DashboardData };
  },
});

function formatKwh(value: number): string {
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(1);
}

function deltaLabel(current: number, prior: number): string {
  if (prior === 0) {
    return current === 0 ? "no change vs prior week" : "new this week";
  }
  const pct = Math.round(((current - prior) / prior) * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}% vs prior week`;
}

export default define.page<typeof handler>(
  function DashboardPage({ data, url, state }) {
    const { overview, isFirstRun } = data;

    // The page is locked to the available viewport (minus the SidebarLayout
    // top bar) on `lg+`, so the dashboard never scrolls the whole window.
    // SectionCard bodies scroll internally via `overflow-auto` if their
    // content exceeds the row height.
    const sectionContent = "flex h-full min-h-0 flex-col overflow-auto p-4";

    // When the welcome banner is showing, let the page scroll naturally —
    // the locked-viewport layout would push the PageCard below the fold.
    const wrapperClass = isFirstRun
      ? "flex min-h-0 flex-col gap-3"
      : "flex h-full min-h-0 flex-col gap-3 lg:h-[calc(100vh-6.5rem)] lg:overflow-hidden";

    return (
      <SidebarLayout currentPath={url.pathname} user={state.user}>
        <div class={wrapperClass}>
          {isFirstRun
            ? (
              <EmptyState
                icon={Zap}
                title="Welcome to ExpressCharge"
                description="Register a charge point in StEvE and scan a tag to get started. Link your first tag to a Lago customer to start billing."
                primaryAction={{
                  label: "Register a tag",
                  href: "/tags/new",
                  icon: Tag,
                }}
                secondaryAction={{
                  label: "Link a tag to a customer",
                  href: "/links/new",
                  icon: Link2,
                }}
                accent="cyan"
                size="lg"
              />
            )
            : null}

          <PageCard
            title="ExpressCharge"
            description="System pulse, live sessions, and fleet health."
            colorScheme="cyan"
            outerClassName="flex min-h-0 flex-1 flex-col"
            className="flex min-h-0 flex-1 flex-col"
            cardClassName="flex h-full min-h-0 flex-col"
            contentClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 sm:p-5"
          >
            <DashboardHeaderStrip
              syncTier={overview.pulse.syncTier}
              nextRunAt={overview.pulse.nextRunAt}
              inFlightSyncRunId={overview.pulse.inFlightSyncRunId}
              chargersOnline={overview.pulse.chargersOnline}
              chargersTotal={overview.pulse.chargersTotal}
              unreadAlerts={overview.pulse.unreadAlerts}
            />

            <DashboardStatStrip
              kwhToday={overview.stats.kwhToday}
              activeSessions={overview.stats.activeSessions}
              chargersOnline={overview.stats.chargersOnline}
              chargersOffline={overview.stats.chargersOffline}
              pendingReservations={overview.stats.pendingReservations}
              syncSuccess7d={overview.stats.syncSuccess7d}
            />

            <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-2">
              <SectionCard
                title="Live now"
                description="Active charging sessions"
                icon={Activity}
                accent="emerald"
                borderBeam
                className="h-full min-h-0"
                contentClassName={sectionContent}
              >
                <LiveSessionsList />
              </SectionCard>

              <SectionCard
                title={overview.inFlightSync
                  ? "Active sync run"
                  : "Sync schedule"}
                description={overview.inFlightSync
                  ? "Live segment progress"
                  : `Tier: ${overview.schedule.currentTier}`}
                icon={Layers}
                accent="blue"
                borderBeam={!!overview.inFlightSync}
                className="h-full min-h-0"
                contentClassName={sectionContent}
              >
                <SyncRunProgressCard
                  inFlight={overview.inFlightSync}
                  schedule={overview.schedule}
                />
              </SectionCard>

              <SectionCard
                title="Health"
                description="Operational warning rollups"
                icon={HeartPulse}
                accent="cyan"
                className="h-full min-h-0"
                contentClassName={sectionContent}
              >
                <HealthSection initial={overview.health} />
              </SectionCard>

              <SectionCard
                title="This week"
                description="Last 7 days"
                icon={TrendingUp}
                accent="cyan"
                className="h-full min-h-0"
                contentClassName={sectionContent}
              >
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MetricTile
                    icon={Zap}
                    label="kWh delivered"
                    value={formatKwh(overview.weekly.kwhWeek)}
                    sublabel={deltaLabel(
                      overview.weekly.kwhWeek,
                      overview.weekly.kwhWeekPrior,
                    )}
                    accent="emerald"
                  />
                  <MetricTile
                    icon={Layers}
                    label="Sync runs"
                    value={overview.weekly.syncRunsWeek}
                    sublabel={`${overview.weekly.syncSuccessWeek}% success`}
                    accent="blue"
                  />
                  <MetricTile
                    icon={Tag}
                    label="Tags activated"
                    value={overview.weekly.tagsActivatedWeek}
                    accent="violet"
                  />
                  <MetricTile
                    icon={Calendar}
                    label="Reservations completed"
                    value={overview.weekly.reservationsCompletedWeek}
                    accent="cyan"
                  />
                </div>
              </SectionCard>
            </div>
          </PageCard>
        </div>
      </SidebarLayout>
    );
  },
);
