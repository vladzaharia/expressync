import { define } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { desc, eq, gte, sql } from "drizzle-orm";
import { SidebarLayout } from "../components/SidebarLayout.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { DotPattern } from "../components/magicui/dot-pattern.tsx";
import { SparklesText } from "../components/magicui/sparkles-text.tsx";
import { BlurFade } from "../components/magicui/blur-fade.tsx";
import { BorderBeam } from "../components/magicui/border-beam.tsx";
import SyncRunsTable from "../islands/SyncRunsTable.tsx";
import RecentTransactionsTable from "../islands/RecentTransactionsTable.tsx";
import DashboardStatsCards from "../islands/DashboardStatsCards.tsx";
import type { SyncRun } from "../src/db/schema.ts";
import { steveClient } from "../src/lib/steve-client.ts";
import { lagoClient } from "../src/lib/lago-client.ts";
import { ArrowRight, Link2, Tag, Zap } from "lucide-preact";
import { accentTailwindClasses, borderBeamColors } from "../src/lib/colors.ts";
import { cn } from "../src/lib/utils/cn.ts";
import { EmptyState } from "../components/shared/EmptyState.tsx";
import LiveChargerTicker from "../islands/dashboard/LiveChargerTicker.tsx";

interface DashboardStats {
  tags: {
    active: number;
    blocked: number;
  };
  lago: {
    customers: number;
    subscriptions: number;
  };
  kwh: {
    day: number;
    week: number;
    month: number;
  };
  syncSuccess: {
    day: number;
    week: number;
    month: number;
  };
}

interface RecentTransaction {
  id: number;
  steveTransactionId: number;
  kwhDelta: string;
  syncedAt: Date | null;
  ocppTag: string | null;
}

interface DashboardData {
  stats: DashboardStats;
  recentSyncRuns: SyncRun[];
  recentTransactions: RecentTransaction[];
  isFirstRun: boolean;
}

const defaultStats: DashboardStats = {
  tags: { active: 0, blocked: 0 },
  lago: { customers: 0, subscriptions: 0 },
  kwh: { day: 0, week: 0, month: 0 },
  syncSuccess: { day: 100, week: 100, month: 100 },
};

async function getDashboardStats(): Promise<DashboardStats> {
  try {
    // Fetch OCPP tags from StEvE
    let activeTags = 0;
    let blockedTags = 0;
    try {
      const tags = await steveClient.getOcppTags();
      activeTags = tags.filter(
        (tag) =>
          tag.maxActiveTransactionCount === null ||
          tag.maxActiveTransactionCount === undefined ||
          tag.maxActiveTransactionCount === -1 ||
          tag.maxActiveTransactionCount > 0,
      ).length;
      blockedTags = tags.filter(
        (tag) => tag.maxActiveTransactionCount === 0,
      ).length;
    } catch (error) {
      console.error("Failed to fetch OCPP tags:", error);
    }

    // Fetch customers and subscriptions from Lago
    let customerCount = 0;
    let subscriptionCount = 0;
    try {
      const [customersData, subscriptionsData] = await Promise.all([
        lagoClient.getCustomers(),
        lagoClient.getSubscriptions(),
      ]);
      customerCount = customersData.customers.length;
      subscriptionCount = subscriptionsData.subscriptions.length;
    } catch (error) {
      console.error("Failed to fetch Lago data:", error);
    }

    // Calculate date ranges
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now);
    monthStart.setDate(monthStart.getDate() - 30);
    monthStart.setHours(0, 0, 0, 0);

    // Convert dates to ISO strings for embedding in SQL templates
    // (postgres.js driver does not accept Date objects as inline sql parameters)
    const todayIso = todayStart.toISOString();
    const weekIso = weekStart.toISOString();

    // Fetch kWh delivered by all three timeframes in a single SQL query
    const [kwhStats] = await db
      .select({
        kwhDay: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncedTransactionEvents.syncedAt} >= ${todayIso} THEN ${schema.syncedTransactionEvents.kwhDelta} ELSE 0 END), 0)`,
        kwhWeek: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncedTransactionEvents.syncedAt} >= ${weekIso} THEN ${schema.syncedTransactionEvents.kwhDelta} ELSE 0 END), 0)`,
        kwhMonth: sql<
          number
        >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
      })
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, monthStart));

    const kwhDay = Number(kwhStats.kwhDay);
    const kwhWeek = Number(kwhStats.kwhWeek);
    const kwhMonth = Number(kwhStats.kwhMonth);

    // Fetch sync success rates by all three timeframes in a single SQL query
    const [syncStats] = await db
      .select({
        dayTotal: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${todayIso} THEN 1 ELSE 0 END), 0)`,
        daySuccess: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${todayIso} AND ${schema.syncRuns.status} = 'completed' THEN 1 ELSE 0 END), 0)`,
        weekTotal: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${weekIso} THEN 1 ELSE 0 END), 0)`,
        weekSuccess: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncRuns.startedAt} >= ${weekIso} AND ${schema.syncRuns.status} = 'completed' THEN 1 ELSE 0 END), 0)`,
        monthTotal: sql<number>`COALESCE(SUM(1), 0)`,
        monthSuccess: sql<
          number
        >`COALESCE(SUM(CASE WHEN ${schema.syncRuns.status} = 'completed' THEN 1 ELSE 0 END), 0)`,
      })
      .from(schema.syncRuns)
      .where(gte(schema.syncRuns.startedAt, monthStart));

    const calcRate = (success: number, total: number) =>
      total === 0 ? 100 : Math.round((success / total) * 100);

    return {
      tags: { active: activeTags, blocked: blockedTags },
      lago: { customers: customerCount, subscriptions: subscriptionCount },
      kwh: {
        day: kwhDay,
        week: kwhWeek,
        month: kwhMonth,
      },
      syncSuccess: {
        day: calcRate(Number(syncStats.daySuccess), Number(syncStats.dayTotal)),
        week: calcRate(
          Number(syncStats.weekSuccess),
          Number(syncStats.weekTotal),
        ),
        month: calcRate(
          Number(syncStats.monthSuccess),
          Number(syncStats.monthTotal),
        ),
      },
    };
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return defaultStats;
  }
}

export const handler = define.handlers({
  async GET(_ctx) {
    // Fetch dashboard statistics directly (avoid internal HTTP fetch)
    const stats = await getDashboardStats();

    // Get recent sync runs (full data for table)
    const recentSyncRuns = await db
      .select()
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(5);

    // Get recent transactions with OCPP tag resolved via userMappings
    const recentTransactions = await db
      .select({
        id: schema.syncedTransactionEvents.id,
        steveTransactionId: schema.syncedTransactionEvents.steveTransactionId,
        kwhDelta: schema.syncedTransactionEvents.kwhDelta,
        syncedAt: schema.syncedTransactionEvents.syncedAt,
        ocppTag: schema.userMappings.steveOcppIdTag,
      })
      .from(schema.syncedTransactionEvents)
      .leftJoin(
        schema.userMappings,
        eq(
          schema.syncedTransactionEvents.userMappingId,
          schema.userMappings.id,
        ),
      )
      .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
      .limit(5);

    // First-run: no active/blocked tags AND no Lago customers yet. Keeps
    // the dashboard skeleton visible underneath so operators can still see
    // the shape of what's coming — the banner sits above it.
    const isFirstRun = stats.tags.active === 0 &&
      stats.tags.blocked === 0 &&
      stats.lago.customers === 0;

    return {
      data: {
        stats,
        recentSyncRuns,
        recentTransactions,
        isFirstRun,
      },
    };
  },
});

export default define.page<typeof handler>(
  function DashboardPage({ data, url, state }) {
    return (
      <SidebarLayout currentPath={url.pathname} user={state.user}>
        {/* Height: auto on mobile (scrollable); on desktop fixed only when */}
        {/* no first-run banner is present (banner needs extra room). */}
        <div
          className={cn(
            "relative min-h-0 overflow-auto",
            data.isFirstRun
              ? "lg:h-auto lg:overflow-auto"
              : "lg:h-[calc(100vh-6.5rem)] lg:overflow-hidden",
          )}
        >
          {/* Subtle background pattern */}
          <DotPattern
            className="absolute inset-0 -z-10 opacity-[0.03] [mask-image:radial-gradient(800px_circle_at_center,white,transparent)]"
            width={20}
            height={20}
            cr={1}
          />

          {/* Header strip: live SSE status chip + first-run banner */}
          <div className="mb-3 flex items-center justify-end">
            <LiveChargerTicker />
          </div>

          {data.isFirstRun
            ? (
              <div className="mb-3">
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

          {/* Main dashboard grid: 1/3 stats, 2/3 tables */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:h-full">
            {/* Left column: Statistics cards (1/3) - 4 cards each 1/4 height */}
            <BlurFade delay={0} duration={0.4} direction="left">
              <div className="lg:col-span-1 lg:h-full">
                <DashboardStatsCards stats={data.stats} />
              </div>
            </BlurFade>

            {/* Right column: Tables (2/3) - 2 tables each 1/2 height */}
            <div className="lg:col-span-2 flex flex-col gap-3 lg:h-full">
              {/* Recent Charging Sessions Table (top half) - Green accent */}
              <BlurFade
                delay={0.1}
                duration={0.4}
                direction="right"
                className="lg:flex-1 lg:min-h-0"
              >
                <Card className="overflow-hidden relative lg:h-full flex flex-col">
                  <BorderBeam
                    size={300}
                    duration={15}
                    delay={0}
                    colorFrom={borderBeamColors.green.from}
                    colorTo={borderBeamColors.green.to}
                  />
                  <CardHeader className="border-b border-border/50 flex-shrink-0 py-1">
                    <CardTitle className="flex items-center justify-between text-base">
                      <SparklesText sparklesCount={6}>
                        Recent Charging Sessions
                      </SparklesText>
                      <a
                        href="/transactions"
                        className={cn(
                          "text-sm font-normal flex items-center gap-1 transition-colors",
                          accentTailwindClasses.green.text,
                          "hover:opacity-80",
                        )}
                      >
                        View all
                        <ArrowRight className="size-4" />
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 px-4 lg:flex-1 lg:overflow-auto">
                    <RecentTransactionsTable
                      transactions={data.recentTransactions}
                      hideHeader
                    />
                  </CardContent>
                </Card>
              </BlurFade>

              {/* Recent Sync Runs Table (bottom half) - Blue accent */}
              <BlurFade
                delay={0.2}
                duration={0.4}
                direction="right"
                className="lg:flex-1 lg:min-h-0"
              >
                <Card className="overflow-hidden relative lg:h-full flex flex-col">
                  <BorderBeam
                    size={300}
                    duration={15}
                    delay={7}
                    colorFrom={borderBeamColors.blue.from}
                    colorTo={borderBeamColors.blue.to}
                  />
                  <CardHeader className="border-b border-border/50 flex-shrink-0 py-1">
                    <CardTitle className="flex items-center justify-between text-base">
                      <SparklesText sparklesCount={6}>
                        Recent Sync Runs
                      </SparklesText>
                      <a
                        href="/sync"
                        className={cn(
                          "text-sm font-normal flex items-center gap-1 transition-colors",
                          accentTailwindClasses.blue.text,
                          "hover:opacity-80",
                        )}
                      >
                        View all
                        <ArrowRight className="size-4" />
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 px-4 lg:flex-1 lg:overflow-auto">
                    <SyncRunsTable
                      syncRuns={data.recentSyncRuns}
                      pageSize={5}
                      showLoadMore={false}
                      hideHeader
                      hideFooterText
                    />
                  </CardContent>
                </Card>
              </BlurFade>
            </div>
          </div>
        </div>
      </SidebarLayout>
    );
  },
);
