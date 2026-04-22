import { define } from "../../utils.ts";
import {
  getSyncListStats,
  getSyncRuns,
  getSyncRunsCount,
  type SyncRunFilters,
} from "../../src/services/sync-db.ts";
import SyncControls from "../../islands/SyncControls.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import SyncRunsTable from "../../islands/SyncRunsTable.tsx";
import SyncRunsFilters from "../../islands/SyncRunsFilters.tsx";
import {
  StatStrip,
  type StatStripItem,
} from "../../components/shared/StatStrip.tsx";
import { Activity, CheckCircle2, Clock, Timer } from "lucide-preact";

const PAGE_SIZE = 15;

type StatusFilter = "" | "completed" | "failed" | "running";
type SegmentFilter = "" | "tag_linking" | "transaction_sync" | "scheduling";

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function formatDurationSeconds(sec: number): string {
  if (!sec || sec <= 0) return "-";
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const rawStatus = url.searchParams.get("status") ?? "";
    const status: StatusFilter =
      rawStatus === "completed" || rawStatus === "failed" ||
        rawStatus === "running"
        ? rawStatus
        : "";
    const rawSegment = url.searchParams.get("segment") ?? "";
    const segment: SegmentFilter =
      rawSegment === "tag_linking" || rawSegment === "transaction_sync" ||
        rawSegment === "scheduling"
        ? rawSegment
        : "";
    const fromStr = url.searchParams.get("from") ?? "";
    const toStr = url.searchParams.get("to") ?? "";

    const filters: SyncRunFilters = {};
    if (status) filters.status = status;
    if (segment) filters.segment = segment;
    const fromDate = parseDate(fromStr);
    if (fromDate) filters.from = fromDate;
    const toDate = parseDate(toStr);
    if (toDate) {
      // Inclusive end of day for `to`.
      toDate.setHours(23, 59, 59, 999);
      filters.to = toDate;
    }

    const [syncRuns, totalCount, stats] = await Promise.all([
      getSyncRuns(PAGE_SIZE, 0, filters),
      getSyncRunsCount(filters),
      getSyncListStats(),
    ]);
    return {
      data: {
        syncRuns,
        totalCount,
        stats,
        filters: { status, segment, from: fromStr, to: toStr },
      },
    };
  },
});

export default define.page<typeof handler>(function SyncPage(
  { data, url, state },
) {
  const isAdmin = state.user?.role === "admin";
  const { stats } = data;

  const lastRunValue = stats.lastRun
    ? (
      <span class="text-sm">
        {stats.lastRun.status.charAt(0).toUpperCase() +
          stats.lastRun.status.slice(1)}
        {" · "}
        {new Date(stats.lastRun.startedAt).toLocaleString()}
      </span>
    )
    : <span class="text-sm text-muted-foreground">No runs yet</span>;

  return (
    <SidebarLayout
      currentPath={url.pathname}
      actions={<SyncControls isAdmin={isAdmin} />}
      accentColor="blue"
      user={state.user}
    >
      <PageCard
        title="Sync History"
        description={`${data.totalCount} sync run${
          data.totalCount !== 1 ? "s" : ""
        } match${data.totalCount === 1 ? "es" : ""} your filters`}
        colorScheme="blue"
      >
        <div class="mb-4">
          <StatStrip
            accent="blue"
            items={[
              {
                key: "runs-24h",
                label: "Runs (24h)",
                value: stats.runs24h,
                icon: Activity,
              },
              {
                key: "success-7d",
                label: "Success rate (7d)",
                value: `${stats.successRate7d.toFixed(0)}%`,
                icon: CheckCircle2,
              },
              {
                key: "avg-duration",
                label: "Avg duration (7d)",
                value: formatDurationSeconds(stats.avgDurationSec7d),
                icon: Timer,
              },
              {
                key: "last-run",
                label: "Last run",
                value: lastRunValue,
                icon: Clock,
              },
            ] satisfies StatStripItem[]}
          />
        </div>

        <div class="mb-4">
          <SyncRunsFilters initial={data.filters} />
        </div>

        <SyncRunsTable
          syncRuns={data.syncRuns}
          totalCount={data.totalCount}
          pageSize={PAGE_SIZE}
          showLoadMore
        />
      </PageCard>
    </SidebarLayout>
  );
});
