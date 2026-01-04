import { define } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { desc, gte } from "drizzle-orm";
import DashboardStats from "../islands/DashboardStats.tsx";
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
import type { SyncRun } from "../src/db/schema.ts";

interface DashboardData {
  stats: {
    totalMappings: number;
    activeMappings: number;
    todayTransactions: number;
    todayKwh: number;
    weekTransactions: number;
    weekKwh: number;
  };
  recentSyncRuns: SyncRun[];
}

export const handler = define.handlers({
  async GET(ctx) {
    // Get mapping counts
    const mappings = await db.select().from(schema.userMappings);
    const totalMappings = mappings.length;
    const activeMappings = mappings.filter((m) => m.isActive).length;

    // Get today's billing events
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayEvents = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, today));

    const todayTransactions = todayEvents.length;
    const todayKwh = todayEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);

    // Get week's billing events
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weekEvents = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .where(gte(schema.syncedTransactionEvents.syncedAt, weekAgo));

    const weekTransactions = weekEvents.length;
    const weekKwh = weekEvents.reduce((sum, ev) => sum + ev.kwhDelta, 0);

    // Get recent sync runs (full data for table)
    const recentSyncRuns = await db
      .select()
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(5);

    return {
      data: {
        stats: {
          totalMappings,
          activeMappings,
          todayTransactions,
          todayKwh,
          weekTransactions,
          weekKwh,
        },
        recentSyncRuns,
      },
    };
  },
});

export default define.page<typeof handler>(
  function DashboardPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
      >
        <div className="space-y-6 relative">
          {/* Subtle background pattern */}
          <DotPattern
            className="absolute inset-0 -z-10 opacity-[0.03] [mask-image:radial-gradient(600px_circle_at_center,white,transparent)]"
            width={20}
            height={20}
            cr={1}
          />

          <BlurFade delay={0} duration={0.4} direction="up">
            <DashboardStats stats={data.stats} />
          </BlurFade>

          <BlurFade delay={0.15} duration={0.4} direction="up">
            <Card className="overflow-hidden relative">
              <CardHeader className="border-b border-border/50">
                <CardTitle className="flex items-center gap-2">
                  <SparklesText sparklesCount={6}>
                    Recent Sync Runs
                  </SparklesText>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pt-4">
                <SyncRunsTable
                  syncRuns={data.recentSyncRuns}
                  pageSize={5}
                  showLoadMore={false}
                />
              </CardContent>
            </Card>
          </BlurFade>
        </div>
      </SidebarLayout>
    );
  },
);
