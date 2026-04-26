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

    return (
      <SidebarLayout currentPath={url.pathname} user={state.user}>
        {isFirstRun
          ? (
            <div class="mb-3">
              <EmptyState
                icon={Zap}
                title="Welcome to ExpresSync"
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
            </div>
          )
          : null}

        <PageCard
          title="ExpresSync"
          description="System pulse, live sessions, and fleet health."
          colorScheme="cyan"
          contentClassName="flex flex-col gap-4 p-4 sm:p-5"
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

          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SectionCard
              title="Live now"
              description="Active charging sessions"
              icon={Activity}
              accent="emerald"
              borderBeam
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
            >
              <HealthSection initial={overview.health} />
            </SectionCard>

            <SectionCard
              title="This week"
              description="Last 7 days"
              icon={TrendingUp}
              accent="cyan"
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
      </SidebarLayout>
    );
  },
);
