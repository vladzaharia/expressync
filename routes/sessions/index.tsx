/**
 * Polaris Track G2 — customer Sessions list (`/sessions`).
 *
 * Listing-page anatomy from the plan:
 *   SidebarLayout(role=customer, accentColor=green)
 *     PageCard(title="Charging Sessions", colorScheme=green)
 *       StatStrip(accent=green) — Sessions (24h), kWh (7d), Active Now (clickable),
 *                                  Avg kWh (7d)
 *       CustomerSessionsFilterBar — URL-backed (mirrors admin pattern)
 *       PaginatedTable with renderMobileCard
 *       EmptyState(accent=green) when no items
 *
 * Loader: scoped via `resolveCustomerScope` so admin viewers without
 * mappings see zero rows. We compute the StatStrip aggregates inline (one
 * cheap pass per metric) instead of an extra round-trip — same pattern as
 * the admin transactions list.
 */

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
  inArray,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import {
  buildCumulativeMap,
  estimateEventCost,
  resolveCustomerTariff,
} from "../../src/lib/customer-tariff.ts";
import { periodWindow } from "../../src/lib/billing-derive.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import {
  EmptyState,
  StatStrip,
  type StatStripItem,
} from "../../components/shared/index.ts";
import CustomerSessionsTable, {
  type CustomerSessionRow,
} from "../../islands/customer/CustomerSessionsTable.tsx";
import CustomerSessionsFilterBar, {
  type CustomerSessionStatus,
} from "../../islands/customer/CustomerSessionsFilterBar.tsx";
import { Activity, BatteryCharging, Gauge, Receipt, Zap } from "lucide-preact";
import { logger } from "../../src/lib/utils/logger.ts";

const log = logger.child("CustomerSessionsPage");

const PAGE_SIZE = 25;

interface Filters {
  status: CustomerSessionStatus;
  from: string;
  to: string;
}

interface SessionStats {
  sessions24h: number;
  kwh7d: number;
  activeNow: number;
  avgKwh7d: number;
}

function parseFilters(url: URL): Filters {
  const rawStatus = url.searchParams.get("status") ?? "all";
  const status: CustomerSessionStatus =
    rawStatus === "active" || rawStatus === "completed" ||
      rawStatus === "failed"
      ? rawStatus
      : "all";
  return {
    status,
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

/**
 * Build the filter SQL combining ownership scope + URL filters. Returns
 * `undefined` when scope is empty so the caller short-circuits to zero.
 */
function buildWhereClause(
  scopeMappingIds: number[],
  filters: Filters,
): SQL | undefined {
  if (scopeMappingIds.length === 0) return undefined;
  const parts: SQL[] = [
    inArray(schema.syncedTransactionEvents.userMappingId, scopeMappingIds),
  ];
  if (filters.status === "active") {
    parts.push(eq(schema.syncedTransactionEvents.isFinal, false));
  } else if (filters.status === "completed") {
    parts.push(eq(schema.syncedTransactionEvents.isFinal, true));
  }
  // `failed` is reserved by the API today (no `is_failed` column yet);
  // accepting it keeps the filter surface forwards-compatible.
  if (filters.from) {
    const d = new Date(filters.from);
    if (!Number.isNaN(d.getTime())) {
      parts.push(gte(schema.syncedTransactionEvents.syncedAt, d));
    }
  }
  if (filters.to) {
    const d = new Date(filters.to + "T23:59:59");
    if (!Number.isNaN(d.getTime())) {
      parts.push(lte(schema.syncedTransactionEvents.syncedAt, d));
    }
  }
  return and(...parts);
}

async function computeStats(
  mappingIds: number[],
): Promise<SessionStats> {
  if (mappingIds.length === 0) {
    return { sessions24h: 0, kwh7d: 0, activeNow: 0, avgKwh7d: 0 };
  }
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const ownership = inArray(
      schema.syncedTransactionEvents.userMappingId,
      mappingIds,
    );

    const [sessions24hRow, kwh7dRow, activeNowRow, distinct7dRow] =
      await Promise.all([
        db
          .select({
            value: countDistinct(
              schema.syncedTransactionEvents.steveTransactionId,
            ),
          })
          .from(schema.syncedTransactionEvents)
          .where(
            and(
              ownership,
              gte(schema.syncedTransactionEvents.syncedAt, startOfDay),
            ),
          ),
        db
          .select({
            value: sql<
              number
            >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
          })
          .from(schema.syncedTransactionEvents)
          .where(
            and(
              ownership,
              gte(schema.syncedTransactionEvents.syncedAt, sevenDaysAgo),
            ),
          ),
        db
          .select({
            value: countDistinct(
              schema.syncedTransactionEvents.steveTransactionId,
            ),
          })
          .from(schema.syncedTransactionEvents)
          .where(
            and(
              ownership,
              eq(schema.syncedTransactionEvents.isFinal, false),
            ),
          ),
        db
          .select({
            value: countDistinct(
              schema.syncedTransactionEvents.steveTransactionId,
            ),
          })
          .from(schema.syncedTransactionEvents)
          .where(
            and(
              ownership,
              gte(schema.syncedTransactionEvents.syncedAt, sevenDaysAgo),
            ),
          ),
      ]);

    const sessions24h = Number(sessions24hRow[0]?.value ?? 0);
    const kwh7d = Number(kwh7dRow[0]?.value ?? 0);
    const activeNow = Number(activeNowRow[0]?.value ?? 0);
    const distinct7d = Number(distinct7dRow[0]?.value ?? 0);
    const avgKwh7d = distinct7d > 0
      ? Math.round((kwh7d / distinct7d) * 100) / 100
      : 0;
    return { sessions24h, kwh7d, activeNow, avgKwh7d };
  } catch (err) {
    log.error("Failed to compute customer session stats", err as Error);
    return { sessions24h: 0, kwh7d: 0, activeNow: 0, avgKwh7d: 0 };
  }
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const filters = parseFilters(url);
    const scope = await resolveCustomerScope(ctx);
    const whereClause = buildWhereClause(scope.mappingIds, filters);

    let totalCount = 0;
    let rows: CustomerSessionRow[] = [];

    // Resolve tariff in parallel with the page query so cost estimates
    // are ready by the time we render rows.
    const tariffPromise = resolveCustomerTariff(scope.lagoCustomerExternalId);

    if (whereClause) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(schema.syncedTransactionEvents)
        .where(whereClause);
      totalCount = Number(value ?? 0);

      const dbRows = await db
        .select({
          event: schema.syncedTransactionEvents,
          ocppTag: schema.userMappings.steveOcppIdTag,
        })
        .from(schema.syncedTransactionEvents)
        .leftJoin(
          schema.userMappings,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .where(whereClause)
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .limit(PAGE_SIZE);

      rows = dbRows.map((r) => ({
        id: r.event.id,
        steveTransactionId: r.event.steveTransactionId,
        ocppTag: r.ocppTag ?? null,
        kwhDelta: r.event.kwhDelta as unknown as string,
        meterValueFrom: r.event.meterValueFrom,
        meterValueTo: r.event.meterValueTo,
        isFinal: r.event.isFinal ?? false,
        syncedAt: r.event.syncedAt ? r.event.syncedAt.toISOString() : null,
        costCents: null,
        costCoverage: "unknown",
      }));
    }

    const [stats, tariff] = await Promise.all([
      computeStats(scope.mappingIds),
      tariffPromise,
    ]);

    // Annotate rows with estimated cost. For sessions in the current
    // billing period we walk tiers using their cumulative position; older
    // sessions only get a number when the plan is flat (no tiers) — we
    // can't reconstruct historical period totals.
    if (rows.length > 0) {
      const { from: periodFrom, to: periodTo } = periodWindow("current");
      const periodFromMs = periodFrom.getTime();
      const periodToMs = periodTo.getTime();

      let cumulative = new Map<number, number>();
      if (tariff.tiers.length > 0 && scope.mappingIds.length > 0) {
        try {
          const periodRows = await db
            .select({
              id: schema.syncedTransactionEvents.id,
              syncedAt: schema.syncedTransactionEvents.syncedAt,
              kwhDelta: schema.syncedTransactionEvents.kwhDelta,
            })
            .from(schema.syncedTransactionEvents)
            .where(
              and(
                inArray(
                  schema.syncedTransactionEvents.userMappingId,
                  scope.mappingIds,
                ),
                gte(schema.syncedTransactionEvents.syncedAt, periodFrom),
                lte(schema.syncedTransactionEvents.syncedAt, periodTo),
              ),
            );
          cumulative = buildCumulativeMap(
            periodRows.map((r) => ({
              id: r.id,
              syncedAtMs: r.syncedAt ? new Date(r.syncedAt).getTime() : 0,
              kwh: Number(r.kwhDelta ?? 0),
            })),
          );
        } catch (err) {
          log.warn("period-cumulative lookup failed; cost estimate disabled", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      rows = rows.map((row) => {
        const ts = row.syncedAt ? new Date(row.syncedAt).getTime() : 0;
        const estimate = estimateEventCost(
          tariff,
          row.id,
          ts,
          Number(row.kwhDelta ?? 0),
          cumulative,
          periodFromMs,
          periodToMs,
        );
        return {
          ...row,
          costCents: estimate.cents,
          costCoverage: estimate.coverage,
        };
      });
    }

    return {
      data: {
        rows,
        totalCount,
        stats,
        filters,
        tariff,
      },
    };
  },
});

export default define.page<typeof handler>(
  function CustomerSessionsPage({ data, url, state }) {
    const { filters, stats } = data;
    const hasActiveFilter = filters.status !== "all" || filters.from !== "" ||
      filters.to !== "";
    const description = data.totalCount === 0
      ? hasActiveFilter
        ? "No sessions match the current filters."
        : "Your charging sessions will appear here."
      : `${data.totalCount} session${data.totalCount === 1 ? "" : "s"}${
        hasActiveFilter ? " match current filters" : ""
      }`;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="green"
        role="customer"
      >
        <PageCard
          title="Charging Sessions"
          description={description}
          colorScheme="green"
        >
          <div class="mb-6">
            <StatStrip
              accent="green"
              items={[
                {
                  key: "sessions-24h",
                  label: "Sessions (24h)",
                  value: stats.sessions24h,
                  icon: Zap,
                },
                {
                  key: "kwh-7d",
                  label: "kWh (7d)",
                  value: stats.kwh7d.toFixed(2),
                  icon: BatteryCharging,
                },
                {
                  key: "active-now",
                  label: "Active now",
                  value: stats.activeNow,
                  icon: Activity,
                  href: "/sessions?status=active",
                  active: filters.status === "active",
                  disabledWhenZero: true,
                },
                {
                  key: "avg-kwh",
                  label: "Avg kWh (7d)",
                  value: stats.avgKwh7d.toFixed(2),
                  icon: Gauge,
                },
              ] satisfies StatStripItem[]}
            />
          </div>

          <CustomerSessionsFilterBar
            initialStatus={filters.status}
            initialFrom={filters.from}
            initialTo={filters.to}
          />

          {data.rows.length === 0
            ? (
              <EmptyState
                icon={Receipt}
                title={hasActiveFilter
                  ? "No matching sessions"
                  : "No sessions yet"}
                description={hasActiveFilter
                  ? "Try clearing the filters above to see your full charging history."
                  : "Your charging sessions will appear here as they're synced."}
                accent="green"
                primaryAction={hasActiveFilter
                  ? { label: "Clear filters", href: "/sessions" }
                  : { label: "Reserve a charger", href: "/reservations/new" }}
              />
            )
            : (
              <CustomerSessionsTable
                sessions={data.rows}
                totalCount={data.totalCount}
                pageSize={PAGE_SIZE}
                tariffPerKwh={data.tariff.perKwh}
                tariffCurrency={data.tariff.currency}
                fetchParams={{
                  ...(filters.status !== "all"
                    ? { status: filters.status }
                    : {}),
                  ...(filters.from ? { from: filters.from } : {}),
                  ...(filters.to ? { to: filters.to } : {}),
                }}
              />
            )}
        </PageCard>
      </SidebarLayout>
    );
  },
);
