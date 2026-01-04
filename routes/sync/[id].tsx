import { define } from "../../utils.ts";
import { getSyncRunWithLogs } from "../../src/services/sync-db.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Link2,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-preact";
import SyncDetailAccordion from "../../islands/SyncDetailAccordion.tsx";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";

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

function BackAction() {
  return (
    <a
      href="/sync"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium hidden sm:inline">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function SyncDetailsPage({ data, url, state }) {
    const { run, logs } = data;
    const tagLinkingLogs = logs.filter((l) => l.segment === "tag_linking");
    const transactionSyncLogs = logs.filter((l) => l.segment === "transaction_sync");

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="blue"
        actions={<BackAction />}
      >
        <div className="space-y-6">
          {/* Summary Card */}
          <PageCard title="Sync Summary" colorScheme="blue">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  {run.status === "completed" ? (
                    <CheckCircle2 className="size-5 text-success" />
                  ) : run.status === "failed" ? (
                    <AlertCircle className="size-5 text-destructive" />
                  ) : (
                    <Loader2 className="size-5 text-primary animate-spin" />
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge
                    variant={
                      run.status === "completed" ? "success" :
                      run.status === "failed" ? "destructive" : "outline"
                    }
                  >
                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Clock className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-semibold">{formatDuration(run.startedAt, run.completedAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10">
                  <RefreshCw className="size-5 text-accent" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Transactions</p>
                  <p className="font-semibold tabular-nums">{run.transactionsProcessed ?? 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10">
                  <Zap className="size-5 text-accent" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Events Created</p>
                  <p className="font-semibold tabular-nums">{run.eventsCreated ?? 0}</p>
                </div>
              </div>
            </div>
          </PageCard>

          {/* Statistics Card */}
          <PageCard title="Sync Statistics" colorScheme="blue">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2">
              {/* Tag Linking Stats */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Link2 className="size-4" />
                  Tag Linking
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-success/10">
                      <CheckCircle2 className="size-5 text-success" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tags Validated</p>
                      <p className="font-semibold tabular-nums">{run.tagsValidated ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-warning/10">
                      <AlertTriangle className="size-5 text-warning" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tags with Issues</p>
                      <p className="font-semibold tabular-nums">{run.tagsWithIssues ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transaction Sync Stats */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <RefreshCw className="size-4" />
                  Transaction Sync
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                      <RefreshCw className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Processed</p>
                      <p className="font-semibold tabular-nums">{run.transactionsProcessed ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10">
                      <Zap className="size-5 text-accent" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Events Created</p>
                      <p className="font-semibold tabular-nums">{run.eventsCreated ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </PageCard>

          {/* Segment Logs */}
          <PageCard
            title="Segment Details"
            description="Expand each segment to view detailed logs"
            colorScheme="blue"
          >
            <SyncDetailAccordion
              run={run}
              tagLinkingLogs={tagLinkingLogs}
              transactionSyncLogs={transactionSyncLogs}
            />
          </PageCard>

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

