/**
 * Polaris Track G2 — customer Card detail (`/cards/[id]`).
 *
 * Detail-page anatomy from the plan:
 *   SidebarLayout(actions=<BackAction href="/cards"/>, accentColor=cyan)
 *     PageCard(title=card.displayName, colorScheme=cyan,
 *              headerActions=<CardStatusBadge/>, <ReportLostButton/>)
 *       SectionCard "Summary" — display name, form-factor, status, issued, last used
 *       SectionCard "Stats" — total sessions / kWh / spent (CardDetailStats island)
 *       SectionCard "Recent sessions" — PaginatedTable filtered to this card
 *
 * The plan calls for a "Report lost" button in the header. MVP renders a
 * disabled mailto-style button so the affordance is visible without wiring
 * the (future) `/api/customer/cards/[id]/report-lost` endpoint that lives
 * in a later track.
 *
 * Ownership: `assertOwnership(ctx, "card", id)` — matches the API endpoint.
 */

import { define } from "../../utils.ts";
import { and, count, desc, eq, max, sum } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { assertOwnership, OwnershipError } from "../../src/lib/scoping.ts";
import { config } from "../../src/lib/config.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import {
  BackAction,
  CardStatusBadge,
  SectionCard,
} from "../../components/shared/index.ts";
import { MetricTile } from "../../components/shared/MetricTile.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Activity,
  Calendar,
  Clock,
  CreditCard,
  Mail,
  Tag as TagIcon,
} from "lucide-preact";
import CardDetailStats from "../../islands/customer/CardDetailStats.tsx";
import CustomerSessionsTable, {
  type CustomerSessionRow,
} from "../../islands/customer/CustomerSessionsTable.tsx";

const RECENT_PAGE_SIZE = 10;

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    const id = parseInt(ctx.params.id ?? "", 10);
    if (!Number.isFinite(id) || id <= 0) {
      return new Response("Not Found", { status: 404 });
    }

    try {
      await assertOwnership(ctx, "card", id);
    } catch (err) {
      if (err instanceof OwnershipError) {
        return new Response("Not Found", { status: 404 });
      }
      throw err;
    }

    const [card] = await db
      .select({
        id: schema.userMappings.id,
        displayName: schema.userMappings.displayName,
        steveOcppIdTag: schema.userMappings.steveOcppIdTag,
        steveOcppTagPk: schema.userMappings.steveOcppTagPk,
        tagType: schema.userMappings.tagType,
        isActive: schema.userMappings.isActive,
        notes: schema.userMappings.notes,
        createdAt: schema.userMappings.createdAt,
        updatedAt: schema.userMappings.updatedAt,
      })
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, id))
      .limit(1);
    if (!card) {
      return new Response("Not Found", { status: 404 });
    }

    const [stats] = await db
      .select({
        totalKwh: sum(schema.syncedTransactionEvents.kwhDelta),
        totalSessions: count(schema.syncedTransactionEvents.id),
        lastUsedAt: max(schema.syncedTransactionEvents.syncedAt),
      })
      .from(schema.syncedTransactionEvents)
      .where(eq(schema.syncedTransactionEvents.userMappingId, id));

    // Recent sessions for this card — first page only; the table loads more
    // via /api/customer/sessions?cardId=N as the user pages through.
    const recentRows = await db
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
      .where(
        and(
          eq(schema.syncedTransactionEvents.userMappingId, id),
        ),
      )
      .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
      .limit(RECENT_PAGE_SIZE);

    const recentSessions: CustomerSessionRow[] = recentRows.map((r) => ({
      id: r.event.id,
      steveTransactionId: r.event.steveTransactionId,
      ocppTag: r.ocppTag ?? null,
      kwhDelta: r.event.kwhDelta as unknown as string,
      meterValueFrom: r.event.meterValueFrom,
      meterValueTo: r.event.meterValueTo,
      isFinal: r.event.isFinal ?? false,
      syncedAt: r.event.syncedAt ? r.event.syncedAt.toISOString() : null,
    }));

    return {
      data: {
        card: {
          id: card.id,
          displayName: card.displayName ?? null,
          ocppTagId: card.steveOcppIdTag,
          ocppTagPk: card.steveOcppTagPk,
          tagType: card.tagType,
          isActive: !!card.isActive,
          createdAt: card.createdAt?.toISOString() ?? null,
          updatedAt: card.updatedAt?.toISOString() ?? null,
        },
        stats: {
          totalKwh: stats?.totalKwh ? Number(stats.totalKwh) : 0,
          totalSessions: Number(stats?.totalSessions ?? 0),
          lastUsedAt: stats?.lastUsedAt ? stats.lastUsedAt.toISOString() : null,
          totalSpentCents: null as number | null,
          totalSpentCurrency: null as string | null,
        },
        recentSessions,
        operatorEmail: config.OPERATOR_CONTACT_EMAIL,
      },
    };
  },
});

function ReportLostButton({ operatorEmail }: { operatorEmail: string }) {
  const subject = encodeURIComponent("Report lost charging card");
  return (
    <Button
      asChild
      variant="outline"
      size="mobile"
    >
      <a href={`mailto:${operatorEmail}?subject=${subject}`}>
        <Mail class="size-4" />
        Report lost
      </a>
    </Button>
  );
}

export default define.page<typeof handler>(
  function CustomerCardDetailPage({ data, url, state }) {
    const { card, stats, recentSessions } = data;
    const name = card.displayName?.trim() || card.ocppTagId;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        role="customer"
        actions={<BackAction href="/cards" />}
      >
        <div class="space-y-6">
          <PageCard
            title={name}
            description={card.displayName && card.ocppTagId !== name
              ? card.ocppTagId
              : undefined}
            colorScheme="cyan"
            headerActions={
              <div class="flex items-center gap-2">
                <CardStatusBadge isActive={card.isActive} large />
                <ReportLostButton operatorEmail={data.operatorEmail} />
              </div>
            }
          >
            <div class="space-y-6">
              <SectionCard title="Summary" icon={CreditCard} accent="cyan">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
                  <MetricTile
                    icon={CreditCard}
                    label="Display name"
                    value={name}
                    accent="cyan"
                  />
                  <MetricTile
                    icon={TagIcon}
                    label="Tag id"
                    value={
                      <span class="font-mono text-sm">{card.ocppTagId}</span>
                    }
                    accent="blue"
                  />
                  <MetricTile
                    icon={Calendar}
                    label="Issued"
                    value={card.createdAt
                      ? new Date(card.createdAt).toLocaleDateString()
                      : "—"}
                    accent="slate"
                  />
                  <MetricTile
                    icon={Clock}
                    label="Last used"
                    value={stats.lastUsedAt
                      ? new Date(stats.lastUsedAt).toLocaleDateString()
                      : "Never"}
                    accent="emerald"
                  />
                </div>
              </SectionCard>

              <CardDetailStats
                totalSessions={stats.totalSessions}
                totalKwh={stats.totalKwh}
                totalSpentCents={stats.totalSpentCents}
                totalSpentCurrency={stats.totalSpentCurrency}
              />

              <SectionCard
                title="Recent sessions"
                description={`${stats.totalSessions} session${
                  stats.totalSessions === 1 ? "" : "s"
                } on this card`}
                icon={Activity}
                accent="cyan"
              >
                {recentSessions.length === 0
                  ? (
                    <p class="py-6 text-center text-sm text-muted-foreground">
                      No sessions on this card yet.
                    </p>
                  )
                  : (
                    <CustomerSessionsTable
                      sessions={recentSessions}
                      totalCount={stats.totalSessions}
                      pageSize={RECENT_PAGE_SIZE}
                      // The customer sessions endpoint doesn't yet accept
                      // ?cardId; fall back to a no-op fetchParams so Load More
                      // brings in the user's whole history. G3 can wire the
                      // per-card filter when the endpoint grows the param.
                      emptyMessage="No sessions on this card yet."
                    />
                  )}
              </SectionCard>
            </div>
          </PageCard>
        </div>
      </SidebarLayout>
    );
  },
);
