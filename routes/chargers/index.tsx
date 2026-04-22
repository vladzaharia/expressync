import { define } from "../../utils.ts";
import { steveClient } from "../../src/lib/steve-client.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import ChargersTable from "../../islands/ChargersTable.tsx";

export const handler = define.handlers({
  async GET(_ctx) {
    let chargeBoxes: Array<{ chargeBoxId: string; chargeBoxPk: number }> = [];

    try {
      chargeBoxes = await steveClient.getChargeBoxes();
    } catch (error) {
      console.error("Failed to fetch charge boxes:", error);
    }

    return { data: { chargeBoxes } };
  },
});

export default define.page<typeof handler>(
  function ChargersPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="orange"
      >
        <PageCard
          title="Chargers"
          description={`${data.chargeBoxes.length} charge box${
            data.chargeBoxes.length !== 1 ? "es" : ""
          } registered`}
          colorScheme="orange"
        >
          <ChargersTable chargeBoxes={data.chargeBoxes} />
        </PageCard>
      </SidebarLayout>
    );
  },
);
