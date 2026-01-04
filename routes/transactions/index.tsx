import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc } from "drizzle-orm";
import TransactionsTable from "../../islands/TransactionsTable.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const events = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
      .limit(100);

    return { data: { events } };
  },
});

export default define.page<typeof handler>(
  function TransactionsPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        title="Billing Events"
        description="View synced charging transactions and billing events"
        user={state.user}
      >
        <Card>
          <CardHeader>
            <CardTitle>Recent Events</CardTitle>
            <CardDescription>
              {data.events.length} event{data.events.length !== 1 ? "s" : ""}
              {" "}
              shown (last 100)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransactionsTable events={data.events} />
          </CardContent>
        </Card>
      </SidebarLayout>
    );
  },
);
