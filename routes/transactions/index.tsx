import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc, sql, eq, count } from "drizzle-orm";
import TransactionsTable from "../../islands/TransactionsTable.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";

const PAGE_SIZE = 15;

// Transaction summary type for the table
export interface TransactionSummary {
  id: number;
  steveTransactionId: number;
  ocppTagId: string | null;
  totalKwhBilled: number;
  isFinalized: boolean;
  lastSyncedAt: Date | null;
  eventCount: number;
}

export const handler = define.handlers({
  async GET(_ctx) {
    // Get total count
    const [{ value: totalCount }] = await db
      .select({ value: count() })
      .from(schema.transactionSyncState);

    // Get paginated transactions
    const transactions = await db
      .select({
        id: schema.transactionSyncState.id,
        steveTransactionId: schema.transactionSyncState.steveTransactionId,
        totalKwhBilled: schema.transactionSyncState.totalKwhBilled,
        isFinalized: schema.transactionSyncState.isFinalized,
        updatedAt: schema.transactionSyncState.updatedAt,
      })
      .from(schema.transactionSyncState)
      .orderBy(desc(schema.transactionSyncState.updatedAt))
      .limit(PAGE_SIZE);

    // Get event counts and OCPP tags for each transaction
    const transactionSummaries: TransactionSummary[] = await Promise.all(
      transactions.map(async (tx) => {
        const events = await db
          .select({
            count: sql<number>`count(*)`,
            ocppTagId: schema.syncedTransactionEvents.ocppTagId,
            lastSyncedAt: sql<Date>`max(${schema.syncedTransactionEvents.syncedAt})`,
          })
          .from(schema.syncedTransactionEvents)
          .where(eq(schema.syncedTransactionEvents.steveTransactionId, tx.steveTransactionId))
          .groupBy(schema.syncedTransactionEvents.ocppTagId);

        const firstEvent = events[0];
        return {
          id: tx.id,
          steveTransactionId: tx.steveTransactionId,
          ocppTagId: firstEvent?.ocppTagId ?? null,
          totalKwhBilled: tx.totalKwhBilled ?? 0,
          isFinalized: tx.isFinalized ?? false,
          lastSyncedAt: firstEvent?.lastSyncedAt ?? tx.updatedAt,
          eventCount: Number(firstEvent?.count ?? 0),
        };
      })
    );

    return { data: { transactions: transactionSummaries, totalCount } };
  },
});

export default define.page<typeof handler>(
  function TransactionsPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="green"
      >
        <PageCard
          title="Charging Transactions"
          description={`${data.totalCount} transaction${data.totalCount !== 1 ? "s" : ""} recorded`}
          colorScheme="green"
        >
          <TransactionsTable
            transactions={data.transactions}
            totalCount={data.totalCount}
            pageSize={PAGE_SIZE}
            showLoadMore={true}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);
