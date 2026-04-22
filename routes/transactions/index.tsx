import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { count, desc, eq, sql } from "drizzle-orm";
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

    // Get paginated transactions with event counts, OCPP tags, and last synced times
    // via a single JOIN query instead of N+1 queries
    const transactionSummaries: TransactionSummary[] = (
      await db
        .select({
          id: schema.transactionSyncState.id,
          steveTransactionId: schema.transactionSyncState.steveTransactionId,
          totalKwhBilled: schema.transactionSyncState.totalKwhBilled,
          isFinalized: schema.transactionSyncState.isFinalized,
          updatedAt: schema.transactionSyncState.updatedAt,
          eventCount: sql<
            number
          >`COALESCE(COUNT(${schema.syncedTransactionEvents.id}), 0)`,
          lastSyncedAt: sql<
            Date
          >`MAX(${schema.syncedTransactionEvents.syncedAt})`,
          ocppTagId: sql<
            string | null
          >`MIN(${schema.userMappings.steveOcppIdTag})`,
        })
        .from(schema.transactionSyncState)
        .leftJoin(
          schema.syncedTransactionEvents,
          eq(
            schema.transactionSyncState.steveTransactionId,
            schema.syncedTransactionEvents.steveTransactionId,
          ),
        )
        .leftJoin(
          schema.userMappings,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .groupBy(
          schema.transactionSyncState.id,
          schema.transactionSyncState.steveTransactionId,
          schema.transactionSyncState.totalKwhBilled,
          schema.transactionSyncState.isFinalized,
          schema.transactionSyncState.updatedAt,
        )
        .orderBy(desc(schema.transactionSyncState.updatedAt))
        .limit(PAGE_SIZE)
    ).map((row) => ({
      id: row.id,
      steveTransactionId: row.steveTransactionId,
      ocppTagId: row.ocppTagId ?? null,
      totalKwhBilled: Number(row.totalKwhBilled) || 0,
      isFinalized: row.isFinalized ?? false,
      lastSyncedAt: row.lastSyncedAt ?? row.updatedAt,
      eventCount: Number(row.eventCount),
    }));

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
          title="Charging Sessions"
          description={`${data.totalCount} session${
            data.totalCount !== 1 ? "s" : ""
          } recorded`}
          colorScheme="green"
        >
          <TransactionsTable
            transactions={data.transactions}
            totalCount={data.totalCount}
            pageSize={PAGE_SIZE}
            showLoadMore
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);
