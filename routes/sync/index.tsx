import { define } from "../../utils.ts";
import { getSyncRuns } from "../../src/services/sync-db.ts";
import SyncControls from "../../islands/SyncControls.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { GridPattern } from "../../components/magicui/grid-pattern.tsx";
import { BorderBeam } from "../../components/magicui/border-beam.tsx";
import SyncEventsTable from "../../islands/SyncEventsTable.tsx";

export const handler = define.handlers({
  async GET(_ctx) {
    const syncRuns = await getSyncRuns(50);
    return { data: { syncRuns } };
  },
});

export default define.page<typeof handler>(function SyncPage(
  { data, url, state },
) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      title="Sync Status"
      description="Monitor and control data synchronization"
      actions={<SyncControls />}
      user={state.user}
    >
      <div className="relative">
        <GridPattern
          width={30}
          height={30}
          className="absolute inset-0 -z-10 opacity-[0.015] [mask-image:linear-gradient(to_bottom,white_20%,transparent_80%)]"
          squares={[[1, 1], [3, 2], [5, 4], [7, 3], [9, 1]]}
        />

        <div className="relative overflow-hidden rounded-xl">
          <Card>
            <CardHeader className="border-b border-border/50">
              <CardTitle>Sync History</CardTitle>
              <CardDescription>
                {data.syncRuns.length} sync run{data.syncRuns.length !== 1 ? "s" : ""} recorded
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SyncEventsTable syncRuns={data.syncRuns} />
            </CardContent>
          </Card>
          <BorderBeam
            size={200}
            duration={15}
            colorFrom="var(--glow-cyan)"
            colorTo="var(--glow-green)"
          />
        </div>
      </div>
    </SidebarLayout>
  );
});
