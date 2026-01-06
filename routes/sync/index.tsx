import { define } from "../../utils.ts";
import { getSyncRuns, getSyncRunsCount } from "../../src/services/sync-db.ts";
import SyncControls from "../../islands/SyncControls.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import SyncRunsTable from "../../islands/SyncRunsTable.tsx";

const PAGE_SIZE = 15;

export const handler = define.handlers({
  async GET(_ctx) {
    const [syncRuns, totalCount] = await Promise.all([
      getSyncRuns(PAGE_SIZE, 0),
      getSyncRunsCount(),
    ]);
    return { data: { syncRuns, totalCount } };
  },
});

export default define.page<typeof handler>(function SyncPage(
  { data, url, state },
) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      actions={<SyncControls />}
      accentColor="blue"
      user={state.user}
    >
      <PageCard
        title="Sync History"
        description={`${data.totalCount} sync run${
          data.totalCount !== 1 ? "s" : ""
        } recorded`}
        colorScheme="blue"
      >
        <SyncRunsTable
          syncRuns={data.syncRuns}
          totalCount={data.totalCount}
          pageSize={PAGE_SIZE}
          showLoadMore={true}
        />
      </PageCard>
    </SidebarLayout>
  );
});
