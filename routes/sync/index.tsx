import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc } from "drizzle-orm";
import SyncControls from "../../islands/SyncControls.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.tsx";
import { Badge } from "../../components/ui/badge.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const syncRuns = await db
      .select()
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(20);

    return { data: { syncRuns } };
  },
});

export default define.page<typeof handler>(function SyncPage({ data, url }) {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "completed": return "success";
      case "failed": return "destructive";
      default: return "warning";
    }
  };

  return (
    <SidebarLayout
      currentPath={url.pathname}
      title="Sync Status"
      description="Monitor and control data synchronization"
      actions={<SyncControls />}
    >
      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
          <CardDescription>Recent synchronization runs between SteVe and Lago</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.syncRuns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No sync runs yet
                  </TableCell>
                </TableRow>
              ) : (
                data.syncRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {run.completedAt ? new Date(run.completedAt).toLocaleString() : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(run.status)}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{run.transactionsProcessed}</TableCell>
                    <TableCell>{run.eventsCreated}</TableCell>
                    <TableCell className="text-destructive max-w-[200px] truncate" title={run.errorMessage || ""}>
                      {run.errorMessage || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </SidebarLayout>
  );
});

