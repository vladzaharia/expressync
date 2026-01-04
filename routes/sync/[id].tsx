import { define } from "../../utils.ts";
import { getSyncRunWithLogs } from "../../src/services/sync-db.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Loader2,
} from "lucide-preact";
import SyncDetailAccordion from "../../islands/SyncDetailAccordion.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const id = parseInt(ctx.params.id);
    if (isNaN(id)) {
      return ctx.redirect("/sync");
    }

    const result = await getSyncRunWithLogs(id);
    if (!result) {
      return ctx.redirect("/sync");
    }

    return { data: result };
  },
});

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "Running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default define.page<typeof handler>(
  function SyncDetailsPage({ data, url, state }) {
    const { run, logs } = data;
    const tagLinkingLogs = logs.filter((l) => l.segment === "tag_linking");
    const transactionSyncLogs = logs.filter((l) => l.segment === "transaction_sync");

    return (
      <SidebarLayout
        currentPath={url.pathname}
        title={`Sync Run #${run.id}`}
        description={`Started ${formatDate(run.startedAt)}`}
        user={state.user}
        actions={
          <Button variant="outline" asChild>
            <a href="/sync">
              <ArrowLeft className="size-4 mr-2" />
              Back to Sync
            </a>
          </Button>
        }
      >
        <div className="space-y-6">
          {/* Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-5" />
                Sync Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={
                      run.status === "completed" ? "success" :
                      run.status === "failed" ? "destructive" : "outline"
                    }
                    className="mt-1"
                  >
                    {run.status === "running" && <Loader2 className="size-3 mr-1 animate-spin" />}
                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{formatDuration(run.startedAt, run.completedAt)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Transactions</p>
                  <p className="font-medium font-mono">{run.transactionsProcessed ?? 0}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Events Created</p>
                  <p className="font-medium font-mono">{run.eventsCreated ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Segment Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Segment Details</CardTitle>
              <CardDescription>
                Expand each segment to view detailed logs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SyncDetailAccordion
                run={run}
                tagLinkingLogs={tagLinkingLogs}
                transactionSyncLogs={transactionSyncLogs}
              />
            </CardContent>
          </Card>

          {/* Errors Card (if any) */}
          {run.errors && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="size-5" />
                  Errors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm text-destructive whitespace-pre-wrap">
                  {run.errors}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarLayout>
    );
  },
);

