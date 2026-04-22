import { define } from "../../utils.ts";
import { getSyncRunWithLogs } from "../../src/services/sync-db.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Link2,
  Loader2,
  Receipt,
  RefreshCw,
  Zap,
} from "lucide-preact";
import SyncDetailAccordion from "../../islands/SyncDetailAccordion.tsx";
import { BackAction } from "../../components/shared/BackAction.tsx";
import { MetricTile } from "../../components/shared/MetricTile.tsx";
import { formatDate, formatDuration } from "../../src/lib/utils/format.ts";

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

export default define.page<typeof handler>(
  function SyncDetailsPage({ data, url, state }) {
    const { run, logs } = data;
    const tagLinkingLogs = logs.filter((l) => l.segment === "tag_linking");
    const transactionSyncLogs = logs.filter((l) =>
      l.segment === "transaction_sync"
    );
    const schedulingLogs = logs.filter((l) => l.segment === "scheduling");

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="blue"
        actions={<BackAction href="/sync" />}
      >
        <div className="space-y-6">
          {/* Summary Card */}
          <PageCard title="Sync Summary" colorScheme="blue">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <span className="text-sm font-bold text-muted-foreground">
                    #
                  </span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ID</p>
                  <p className="font-semibold tabular-nums">{run.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  {run.status === "completed"
                    ? <CheckCircle2 className="size-5 text-success" />
                    : run.status === "failed"
                    ? <AlertCircle className="size-5 text-destructive" />
                    : <Loader2 className="size-5 text-primary animate-spin" />}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge
                    variant={run.status === "completed"
                      ? "success"
                      : run.status === "failed"
                      ? "destructive"
                      : "outline"}
                  >
                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                  </Badge>
                </div>
              </div>
              <MetricTile
                icon={Clock}
                label="Time Started"
                value={
                  <span className="text-sm">{formatDate(run.startedAt)}</span>
                }
                accent="blue"
              />
              <MetricTile
                icon={Clock}
                label="Duration"
                value={formatDuration(run.startedAt, run.completedAt)}
                accent="blue"
              />
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
                <div className="grid grid-cols-3 gap-4">
                  <MetricTile
                    icon={CheckCircle2}
                    label="Tags Activated"
                    value={run.tagsActivated ?? 0}
                    accent="green"
                  />
                  <MetricTile
                    icon={AlertCircle}
                    label="Tags Deactivated"
                    value={run.tagsDeactivated ?? 0}
                    accent="red"
                  />
                  <MetricTile
                    icon={RefreshCw}
                    label="Tags Unchanged"
                    value={run.tagsUnchanged ?? 0}
                    accent="blue"
                  />
                </div>
              </div>

              {/* Transaction Sync Stats */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Receipt className="size-4" />
                  Charging Sessions
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <MetricTile
                    icon={RefreshCw}
                    label="Processed"
                    value={run.transactionsProcessed ?? 0}
                    accent="blue"
                  />
                  <MetricTile
                    icon={Zap}
                    label="Events Created"
                    value={run.eventsCreated ?? 0}
                    accent="green"
                  />
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
              schedulingLogs={schedulingLogs}
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
