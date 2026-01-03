import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc } from "drizzle-orm";
import TransactionsTable from "../../islands/TransactionsTable.tsx";

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

export default define.page<typeof handler>(function TransactionsPage({ data }) {
  return (
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Billing Events</h1>

      <TransactionsTable events={data.events} />
    </div>
  );
});

