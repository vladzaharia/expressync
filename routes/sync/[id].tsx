import { define } from "../../utils.ts";
import { getSyncRunWithLogs } from "../../src/services/sync-db.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { Badge } from "../../components/ui/badge.tsx";
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
import SyncSegmentTabs from "../../islands/SyncSegmentTabs.tsx";
import SyncRetryButton from "../../islands/SyncRetryButton.tsx";
import { BackAction } from "../../components/shared/BackAction.tsx";
import { MetricTile } from "../../components/shared/MetricTile.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
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
    const isAdmin = state.user?.role === "admin";
    const runIsRunning = run.status === "running";
    const canRetry = run.status === "failed" && isAdmin;

    const statusLabel = run.status.charAt(0).toUpperCase() +
      run.status.slice(1);
    const statusIcon = run.status === "completed"
      ? <CheckCircle2 className="size-5 text-success" />
      : run.status === "failed"
      ? <AlertCircle className="size-5 text-destructive" />
      : <Loader2 className="size-5 text-primary animate-spin" />;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="blue"
        actions={<BackAction href="/sync" />}
      >
        <PageCard
          title={`Sync Run #${run.id}`}
          description={`${statusLabel} · started ${formatDate(run.startedAt)}`}
          colorScheme="blue"
          headerActions={canRetry
            ? <SyncRetryButton runId={run.id} />
            : undefined}
        >
          <div className="flex flex-col gap-6">
            <SectionCard
              title="Summary"
              icon={Clock}
              accent="blue"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
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
                    {statusIcon}
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
                      {statusLabel}
                    </Badge>
                  </div>
                </div>
                <MetricTile
                  icon={Clock}
                  label="Time started"
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
            </SectionCard>

            <SectionCard
              title="Statistics"
              description="Rolled up counters for this run"
              icon={RefreshCw}
              accent="blue"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Link2 className="size-4" />
                    Tag linking
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <MetricTile
                      icon={CheckCircle2}
                      label="Tags activated"
                      value={run.tagsActivated ?? 0}
                      accent="emerald"
                    />
                    <MetricTile
                      icon={AlertCircle}
                      label="Tags deactivated"
                      value={run.tagsDeactivated ?? 0}
                      accent="rose"
                    />
                    <MetricTile
                      icon={RefreshCw}
                      label="Tags unchanged"
                      value={run.tagsUnchanged ?? 0}
                      accent="blue"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Receipt className="size-4" />
                    Charging sessions
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
                      label="Events created"
                      value={run.eventsCreated ?? 0}
                      accent="emerald"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Segment details"
              description="Switch tabs to inspect logs from each segment"
              icon={Receipt}
              accent="blue"
              contentClassName="p-0"
            >
              <SyncSegmentTabs
                run={run}
                tagLinkingLogs={tagLinkingLogs}
                transactionSyncLogs={transactionSyncLogs}
                schedulingLogs={schedulingLogs}
                runIsRunning={runIsRunning}
              />
            </SectionCard>

            {run.errors && (
              <SectionCard
                title="Errors"
                icon={AlertCircle}
                accent="rose"
              >
                <pre className="text-sm text-destructive whitespace-pre-wrap">
                  {run.errors}
                </pre>
              </SectionCard>
            )}
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
