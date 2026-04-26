/**
 * Polaris Track G2 — customer Cards list (`/cards`).
 *
 * Listing-page anatomy from the plan with one tweak: cards render as a grid
 * of SectionCards instead of a PaginatedTable (small N per customer, more
 * visual). Per plan:
 *   StatStrip(accent=cyan) — Active | Inactive (clickable) | Total Sessions
 *                            | Last Used
 *   EmptyState(accent=cyan, icon=CreditCard) when no cards
 *
 * Loader: scoped via `resolveCustomerScope`. Stats roll up the same
 * mappings the API endpoint returns so numbers match what the user sees in
 * each tile.
 */

import { define } from "../../utils.ts";
import { count, desc, eq, max, sum } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import { config } from "../../src/lib/config.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import {
  EmptyState,
  StatStrip,
  type StatStripItem,
} from "../../components/shared/index.ts";
import {
  Activity,
  CheckCircle2,
  Clock,
  CreditCard,
  XCircle,
} from "lucide-preact";
import { formatRelative } from "../../islands/shared/device-visuals.ts";
import CustomerCardList, {
  type CustomerCard,
} from "../../islands/customer/CustomerCardList.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const statusFilter = url.searchParams.get("status"); // "active" | "inactive" | null
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const scope = await resolveCustomerScope(ctx);

    let allCards: CustomerCard[] = [];
    if (scope.mappingIds.length > 0) {
      const rows = await db
        .select({
          id: schema.userMappings.id,
          displayName: schema.userMappings.displayName,
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
          steveOcppTagPk: schema.userMappings.steveOcppTagPk,
          tagType: schema.userMappings.tagType,
          isActive: schema.userMappings.isActive,
          createdAt: schema.userMappings.createdAt,
          sessionCount: count(schema.syncedTransactionEvents.id),
          lastUsedAt: max(schema.syncedTransactionEvents.syncedAt),
          totalKwh: sum(schema.syncedTransactionEvents.kwhDelta),
        })
        .from(schema.userMappings)
        .leftJoin(
          schema.syncedTransactionEvents,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .where(
          eq(
            schema.userMappings.userId,
            ctx.state.actingAs ?? ctx.state.user!.id,
          ),
        )
        .groupBy(schema.userMappings.id)
        .orderBy(
          desc(schema.userMappings.isActive),
          desc(schema.userMappings.createdAt),
        );

      allCards = rows.map((r) => ({
        id: r.id,
        displayName: r.displayName ?? null,
        ocppTagId: r.steveOcppIdTag,
        ocppTagPk: r.steveOcppTagPk,
        tagType: r.tagType,
        isActive: !!r.isActive,
        createdAt: r.createdAt?.toISOString() ?? null,
        sessionCount: Number(r.sessionCount ?? 0),
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        totalKwh: r.totalKwh ? Number(r.totalKwh) : 0,
      }));
    }

    // Stats are computed against the FULL card set (so the strip matches
    // the user's overall picture even when a filter narrows the grid).
    const activeCount = allCards.filter((c) => c.isActive).length;
    const inactiveCount = allCards.filter((c) => !c.isActive).length;
    const totalSessions = allCards.reduce((acc, c) => acc + c.sessionCount, 0);
    const lastUsedAt = allCards.reduce<string | null>((acc, c) => {
      if (!c.lastUsedAt) return acc;
      if (!acc) return c.lastUsedAt;
      return new Date(c.lastUsedAt) > new Date(acc) ? c.lastUsedAt : acc;
    }, null);

    // Filter the displayed grid AFTER computing aggregates.
    let filtered = allCards;
    if (statusFilter === "active") {
      filtered = filtered.filter((c) => c.isActive);
    } else if (statusFilter === "inactive") {
      filtered = filtered.filter((c) => !c.isActive);
    }
    if (search) {
      filtered = filtered.filter((c) => {
        const name = (c.displayName ?? "").toLowerCase();
        const tag = c.ocppTagId.toLowerCase();
        return name.includes(search) || tag.includes(search);
      });
    }

    return {
      data: {
        cards: filtered,
        totalCards: allCards.length,
        operatorEmail: config.OPERATOR_CONTACT_EMAIL,
        statusFilter,
        search,
        stats: {
          activeCount,
          inactiveCount,
          totalSessions,
          lastUsedAt,
        },
      },
    };
  },
});

export default define.page<typeof handler>(
  function CustomerCardsPage({ data, url, state }) {
    const { stats, statusFilter } = data;
    const lastUsedDisplay = stats.lastUsedAt
      ? formatRelative(stats.lastUsedAt)
      : "Never";
    const description = data.totalCards === 0
      ? "Cards your operator linked to your account will appear here."
      : `${data.totalCards} card${data.totalCards === 1 ? "" : "s"}`;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        role="customer"
      >
        <PageCard
          title="Your cards"
          description={description}
          colorScheme="cyan"
        >
          <div class="mb-6">
            <StatStrip
              accent="cyan"
              items={[
                {
                  key: "active",
                  label: "Active",
                  value: stats.activeCount,
                  icon: CheckCircle2,
                  href: "/cards?status=active",
                  active: statusFilter === "active",
                  disabledWhenZero: true,
                },
                {
                  key: "inactive",
                  label: "Inactive",
                  value: stats.inactiveCount,
                  icon: XCircle,
                  href: "/cards?status=inactive",
                  active: statusFilter === "inactive",
                  disabledWhenZero: true,
                },
                {
                  key: "total-sessions",
                  label: "Total sessions",
                  value: stats.totalSessions,
                  icon: Activity,
                },
                {
                  key: "last-used",
                  label: "Last used",
                  value: lastUsedDisplay,
                  icon: Clock,
                },
              ] satisfies StatStripItem[]}
            />
          </div>

          {data.cards.length === 0
            ? (
              data.totalCards === 0
                ? (
                  <EmptyState
                    icon={CreditCard}
                    title="No cards linked yet"
                    description="Contact your operator to get a card linked to your account."
                    accent="cyan"
                    primaryAction={{
                      label: "Contact operator",
                      href: `mailto:${data.operatorEmail}`,
                      icon: CreditCard,
                    }}
                  />
                )
                : (
                  <EmptyState
                    icon={CreditCard}
                    title="No matching cards"
                    description="Try clearing the filters above to see all cards on your account."
                    accent="cyan"
                    primaryAction={{
                      label: "Show all cards",
                      href: "/cards",
                    }}
                  />
                )
            )
            : <CustomerCardList cards={data.cards} />}
        </PageCard>
      </SidebarLayout>
    );
  },
);
