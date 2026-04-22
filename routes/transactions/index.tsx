import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import TransactionsTable from "../../islands/TransactionsTable.tsx";
import ChargingSessionsFilters, {
  type ChargingSessionStatus,
} from "../../islands/ChargingSessionsFilters.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { StatStrip, type StatStripItem } from "@/components/shared/index.ts";
import { Activity, BatteryCharging, Gauge, Zap } from "lucide-preact";

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

interface Filters {
  status: ChargingSessionStatus;
  from: string;
  to: string;
  tag: string;
}

interface TransactionStats {
  sessionsToday: number;
  kwh7d: number;
  activeNow: number;
  avgKwh7d: number;
}

function parseFilters(url: URL): Filters {
  const rawStatus = url.searchParams.get("status") ?? "all";
  const status: ChargingSessionStatus =
    rawStatus === "active" || rawStatus === "completed" ? rawStatus : "all";
  return {
    status,
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    tag: url.searchParams.get("tag") ?? "",
  };
}

function buildTxStateConditions(filters: Filters): SQL | undefined {
  const parts: SQL[] = [];
  if (filters.status === "active") {
    parts.push(eq(schema.transactionSyncState.isFinalized, false));
  } else if (filters.status === "completed") {
    parts.push(eq(schema.transactionSyncState.isFinalized, true));
  }
  if (filters.from) {
    parts.push(
      gte(schema.transactionSyncState.updatedAt, new Date(filters.from)),
    );
  }
  if (filters.to) {
    parts.push(
      lte(
        schema.transactionSyncState.updatedAt,
        new Date(filters.to + "T23:59:59"),
      ),
    );
  }
  if (filters.tag) {
    parts.push(ilike(schema.userMappings.steveOcppIdTag, `%${filters.tag}%`));
  }
  if (parts.length === 0) return undefined;
  return and(...parts);
}

async function computeStats(): Promise<TransactionStats> {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [sessionsTodayRow, kwh7dRow, activeNowRow, distinct7dRow] =
      await Promise.all([
        db
          .select({
            value: countDistinct(
              schema.transactionSyncState.steveTransactionId,
            ),
          })
          .from(schema.transactionSyncState)
          .where(gte(schema.transactionSyncState.updatedAt, startOfToday)),
        db
          .select({
            value: sql<
              number
            >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
          })
          .from(schema.syncedTransactionEvents)
          .where(gte(schema.syncedTransactionEvents.syncedAt, sevenDaysAgo)),
        db
          .select({ value: count() })
          .from(schema.transactionSyncState)
          .where(eq(schema.transactionSyncState.isFinalized, false)),
        db
          .select({
            value: countDistinct(
              schema.syncedTransactionEvents.steveTransactionId,
            ),
          })
          .from(schema.syncedTransactionEvents)
          .where(gte(schema.syncedTransactionEvents.syncedAt, sevenDaysAgo)),
      ]);

    const sessionsToday = Number(sessionsTodayRow[0]?.value ?? 0);
    const kwh7d = Number(kwh7dRow[0]?.value ?? 0);
    const activeNow = Number(activeNowRow[0]?.value ?? 0);
    const distinct7d = Number(distinct7dRow[0]?.value ?? 0);
    const avgKwh7d = distinct7d > 0
      ? Math.round((kwh7d / distinct7d) * 100) / 100
      : 0;

    return { sessionsToday, kwh7d, activeNow, avgKwh7d };
  } catch (err) {
    console.error("Failed to compute charging session stats", err);
    return { sessionsToday: 0, kwh7d: 0, activeNow: 0, avgKwh7d: 0 };
  }
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const filters = parseFilters(url);
    const whereClause = buildTxStateConditions(filters);
    const needsTagJoin = Boolean(filters.tag);

    const [stats, countResult, summaries] = await Promise.all([
      computeStats(),
      (async () => {
        // Count matching transaction_sync_state rows after filters. When the
        // tag filter is active we need DISTINCT on the id because the join to
        // user_mappings via syncedTransactionEvents can multiply rows.
        const base = db
          .select({
            value: needsTagJoin
              ? countDistinct(schema.transactionSyncState.id)
              : count(),
          })
          .from(schema.transactionSyncState);
        const withJoins = needsTagJoin
          ? base
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
          : base;
        const rows = whereClause
          ? await withJoins.where(whereClause)
          : await withJoins;
        return rows[0]?.value ?? 0;
      })(),
      (async () => {
        const query = db
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
          );
        const filtered = whereClause ? query.where(whereClause) : query;
        return await filtered
          .groupBy(
            schema.transactionSyncState.id,
            schema.transactionSyncState.steveTransactionId,
            schema.transactionSyncState.totalKwhBilled,
            schema.transactionSyncState.isFinalized,
            schema.transactionSyncState.updatedAt,
          )
          .orderBy(desc(schema.transactionSyncState.updatedAt))
          .limit(PAGE_SIZE);
      })(),
    ]);

    const totalCount = Number(countResult);

    const transactionSummaries: TransactionSummary[] = summaries.map((row) => ({
      id: row.id,
      steveTransactionId: row.steveTransactionId,
      ocppTagId: row.ocppTagId ?? null,
      totalKwhBilled: Number(row.totalKwhBilled) || 0,
      isFinalized: row.isFinalized ?? false,
      lastSyncedAt: row.lastSyncedAt ?? row.updatedAt,
      eventCount: Number(row.eventCount),
    }));

    return {
      data: {
        transactions: transactionSummaries,
        totalCount,
        stats,
        filters,
      },
    };
  },
});

export default define.page<typeof handler>(
  function TransactionsPage({ data, url, state }) {
    const { filters } = data;
    const hasActiveFilter = filters.status !== "all" || filters.from !== "" ||
      filters.to !== "" || filters.tag !== "";
    const emptyMessage = hasActiveFilter
      ? "No charging sessions match the current filters. Try clearing them."
      : "No charging sessions found. Sessions will appear here after syncing.";

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
          }${hasActiveFilter ? " match current filters" : " recorded"}`}
          colorScheme="green"
        >
          <div class="mb-6">
            <StatStrip
              accent="green"
              items={[
                {
                  key: "sessions-today",
                  label: "Sessions today",
                  value: data.stats.sessionsToday,
                  icon: Zap,
                },
                {
                  key: "kwh-7d",
                  label: "kWh delivered (7d)",
                  value: data.stats.kwh7d.toFixed(2),
                  icon: BatteryCharging,
                },
                {
                  key: "active-now",
                  label: "Active now",
                  value: data.stats.activeNow,
                  icon: Activity,
                },
                {
                  key: "avg-kwh",
                  label: "Avg kWh / session (7d)",
                  value: data.stats.avgKwh7d.toFixed(2),
                  icon: Gauge,
                },
              ] satisfies StatStripItem[]}
            />
          </div>

          <ChargingSessionsFilters
            initialStatus={filters.status}
            initialFrom={filters.from}
            initialTo={filters.to}
            initialTag={filters.tag}
          />

          <TransactionsTable
            transactions={data.transactions}
            totalCount={data.totalCount}
            pageSize={PAGE_SIZE}
            showLoadMore
            fetchParams={{
              ...(filters.status !== "all" ? { status: filters.status } : {}),
              ...(filters.from ? { from: filters.from } : {}),
              ...(filters.to ? { to: filters.to } : {}),
              ...(filters.tag ? { tag: filters.tag } : {}),
            }}
            emptyMessage={emptyMessage}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);
