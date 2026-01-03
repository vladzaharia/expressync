import { define } from "../utils.ts";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import { desc, gte } from "drizzle-orm";
import DashboardStats from "../islands/DashboardStats.tsx";
import { SidebarLayout } from "../components/SidebarLayout.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx";
import { Badge } from "../components/ui/badge.tsx";

interface DashboardData {
  stats: {
    totalMappings: number;
    activeMappings: number;
    todayTransactions: number;
    todayKwh: number;
    weekTransactions: number;
    weekKwh: number;
  };
  recentSyncRuns: Array<{
    id: number;
    startedAt: Date;
    status: string;
    transactionsProcessed: number;
    eventsCreated: number;
  }>;
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

    // Get recent sync runs
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

export default define.page<typeof handler>(function DashboardPage({ data, url }) {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "completed": return "success";
      case "failed": return "destructive";
      default: return "warning";
    }
  };

  return (
    <SidebarLayout currentPath={url.pathname} title="Dashboard" description="Overview of your EV billing system">
      <div className="space-y-6">
        <DashboardStats stats={data.stats} />

        <Card>
          <CardHeader>
            <CardTitle>Recent Sync Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentSyncRuns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No sync runs yet
                    </TableCell>
                  </TableRow>
                ) : (
                  data.recentSyncRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium">
                        {new Date(run.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(run.status)}>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{run.transactionsProcessed}</TableCell>
                      <TableCell>{run.eventsCreated}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </SidebarLayout>
  );
});
