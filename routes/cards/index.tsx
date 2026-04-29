/**
 * Customer EV Cards list (`/cards`).
 *
 * Source of truth is StEvE — fetch the live OCPP tag roster and intersect
 * with this user's `user_mappings` rows (by `steveOcppTagPk`). That mirrors
 * the admin EV Cards page (`routes/admin/tags/index.tsx`) and makes
 * deleted-from-StEvE tags fall out automatically without needing a cleanup
 * pass on `user_mappings`.
 *
 * Meta-tags (the auto-managed `OCPP-{externalId}` parents) are hidden
 * unconditionally — customers can't act on them and they exist purely to
 * enable remote-start when no physical card is present. No escape hatch.
 *
 * Loader: scoped via `resolveCustomerScope`. Stats and the filtered grid
 * derive from the same intersected card set so numbers always match.
 */

import { define } from "../../utils.ts";
import { count, desc, eq, inArray, max, sum } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { resolveCustomerScope } from "../../src/lib/scoping.ts";
import { steveClient } from "../../src/lib/steve-client.ts";
import { isMetaTag } from "../../src/lib/tag-hierarchy.ts";
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
      // Live StEvE roster is the ground truth. Tags deleted in StEvE drop
      // out of this set even if their `user_mappings` row lingers.
      const ocppTags = await steveClient.getOcppTags().catch(() => []);
      const livePkSet = new Set(ocppTags.map((t) => t.ocppTagPk));

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
        .where(inArray(schema.userMappings.id, scope.mappingIds))
        .groupBy(schema.userMappings.id)
        .orderBy(
          desc(schema.userMappings.isActive),
          desc(schema.userMappings.createdAt),
        );

      allCards = rows
        .filter((r) => livePkSet.has(r.steveOcppTagPk)) // drop StEvE-orphans
        .filter((r) => !isMetaTag(r.steveOcppIdTag))   // hide meta-tags
        .map((r) => ({
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
      ? "EV Cards your operator linked to your account will appear here."
      : `${data.totalCards} EV Card${data.totalCards === 1 ? "" : "s"}`;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        role="customer"
      >
        <PageCard
          title="Your EV Cards"
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
                    title="No EV Cards linked yet"
                    description="Contact your operator to get an EV Card linked to your account."
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
                    title="No matching EV Cards"
                    description="Try clearing the filters above to see all EV Cards on your account."
                    accent="cyan"
                    primaryAction={{
                      label: "Show all EV Cards",
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
