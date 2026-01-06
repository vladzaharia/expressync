import { define } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { desc, gte } from "drizzle-orm";
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
import SyncRunsTable from "../islands/SyncRunsTable.tsx";
import RecentTransactionsTable from "../islands/RecentTransactionsTable.tsx";
import DashboardStatsCards from "../islands/DashboardStatsCards.tsx";
import type { SyncedTransactionEvent, SyncRun } from "../src/db/schema.ts";
import { steveClient } from "../src/lib/steve-client.ts";
import { lagoClient } from "../src/lib/lago-client.ts";
import { ArrowRight } from "lucide-preact";

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

interface DashboardData {
  stats: DashboardStats;
  recentSyncRuns: SyncRun[];
  recentTransactions: SyncedTransactionEvent[];
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

    // Fetch kWh delivered by timeframe
    const [dayEvents, weekEvents, monthEvents] = await Promise.all([
      db
        .select()
        .from(schema.syncedTransactionEvents)
        .where(gte(schema.syncedTransactionEvents.syncedAt, todayStart)),
      db
        .select()
        .from(schema.syncedTransactionEvents)
        .where(gte(schema.syncedTransactionEvents.syncedAt, weekStart)),
      db
        .select()
        .from(schema.syncedTransactionEvents)
        .where(gte(schema.syncedTransactionEvents.syncedAt, monthStart)),
    ]);

    const kwhDay = dayEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);
    const kwhWeek = weekEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);
    const kwhMonth = monthEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);

    // Fetch sync success rates by timeframe
    const [daySyncs, weekSyncs, monthSyncs] = await Promise.all([
      db
        .select()
        .from(schema.syncRuns)
        .where(gte(schema.syncRuns.startedAt, todayStart)),
      db
        .select()
        .from(schema.syncRuns)
        .where(gte(schema.syncRuns.startedAt, weekStart)),
      db
        .select()
        .from(schema.syncRuns)
        .where(gte(schema.syncRuns.startedAt, monthStart)),
    ]);

    const calculateSuccessRate = (syncs: typeof daySyncs) => {
      if (syncs.length === 0) return 100;
      const successful = syncs.filter((s) => s.status === "completed").length;
      return Math.round((successful / syncs.length) * 100);
    };

    return {
      tags: { active: activeTags, blocked: blockedTags },
      lago: { customers: customerCount, subscriptions: subscriptionCount },
      kwh: {
        day: kwhDay,
        week: kwhWeek,
        month: kwhMonth,
      },
      syncSuccess: {
        day: calculateSuccessRate(daySyncs),
        week: calculateSuccessRate(weekSyncs),
        month: calculateSuccessRate(monthSyncs),
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

    // Get recent transactions
    const recentTransactions = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
      .limit(5);

    return {
      data: {
        stats,
        recentSyncRuns,
        recentTransactions,
      },
    };
  },
});

export default define.page<typeof handler>(
  function DashboardPage({ data, url, state }) {
    return (
      <SidebarLayout currentPath={url.pathname} user={state.user}>
        {/* Height: auto on mobile (scrollable), fixed on desktop */}
        <div className="relative min-h-0 lg:h-[calc(100vh-6.5rem)] overflow-auto lg:overflow-hidden">
          {/* Subtle background pattern */}
          <DotPattern
            className="absolute inset-0 -z-10 opacity-[0.03] [mask-image:radial-gradient(800px_circle_at_center,white,transparent)]"
            width={20}
            height={20}
            cr={1}
          />

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
              {/* Recent Transactions Table (top half) */}
              <BlurFade
                delay={0.1}
                duration={0.4}
                direction="right"
                className="lg:flex-1 lg:min-h-0"
              >
                <Card className="overflow-hidden relative lg:h-full flex flex-col">
                  <CardHeader className="border-b border-border/50 flex-shrink-0 py-1">
                    <CardTitle className="flex items-center justify-between text-base">
                      <SparklesText sparklesCount={6}>
                        Recent Transactions
                      </SparklesText>
                      <a
                        href="/transactions"
                        className="text-sm font-normal text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      >
                        View all
                        <ArrowRight className="size-4" />
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 px-2 lg:flex-1 lg:overflow-auto">
                    <RecentTransactionsTable
                      transactions={data.recentTransactions}
                      hideHeader
                    />
                  </CardContent>
                </Card>
              </BlurFade>

              {/* Recent Sync Runs Table (bottom half) */}
              <BlurFade
                delay={0.2}
                duration={0.4}
                direction="right"
                className="lg:flex-1 lg:min-h-0"
              >
                <Card className="overflow-hidden relative lg:h-full flex flex-col">
                  <CardHeader className="border-b border-border/50 flex-shrink-0 py-1">
                    <CardTitle className="flex items-center justify-between text-base">
                      <SparklesText sparklesCount={6}>
                        Recent Sync Runs
                      </SparklesText>
                      <a
                        href="/sync"
                        className="text-sm font-normal text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      >
                        View all
                        <ArrowRight className="size-4" />
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 px-2 lg:flex-1 lg:overflow-auto">
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
