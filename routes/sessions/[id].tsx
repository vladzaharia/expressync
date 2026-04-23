/**
 * Polaris Track G2 — customer Session detail (`/sessions/[id]`).
 *
 * Detail-page anatomy from the plan:
 *   SidebarLayout(actions=<BackAction href="/sessions"/>, accentColor=green)
 *     PageCard(title="Session #N", colorScheme=green,
 *              headerActions=<TransactionStatusBadge/>)
 *       [SectionCard "Live"] — only when isFinalized=false
 *         LiveSessionCard (reused from islands/charging-sessions)
 *       SectionCard "Summary" — kWh / Duration / Cost / Avg kW
 *       SectionCard "Charger" — name / connector / Card used (cross-link)
 *       SectionCard "Meter timeline" — SessionMeterTimeline island
 *
 * Loader uses `assertOwnership` (404 on miss to avoid 403 enumeration).
 *
 * The ownership check + meter timeline read mirrors `/api/customer/sessions/[id]`
 * exactly — we duplicate the small query rather than fetch through HTTP so
 * SSR doesn't pay an extra round trip. Both surfaces hit the same
 * `assertOwnership` so behaviour stays consistent.
 */

import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { and, asc, eq, sql } from "drizzle-orm";
import { assertOwnership, OwnershipError } from "../../src/lib/scoping.ts";
import { steveClient } from "../../src/lib/steve-client.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import {
  BackAction,
  SectionCard,
  TransactionStatusBadge,
} from "../../components/shared/index.ts";
import { Activity } from "lucide-preact";
import LiveSessionCard from "../../islands/charging-sessions/LiveSessionCard.tsx";
import SessionMeterTimeline from "../../islands/customer/SessionMeterTimeline.tsx";
import { SessionDetailCard } from "../../components/customer/SessionDetailCard.tsx";

const log = logger.child("CustomerSessionDetailPage");

interface MeterRow {
  id: number;
  syncedAt: string | null;
  kwhDelta: string | number;
  meterValueFrom: number;
  meterValueTo: number;
  isFinal: boolean | null;
}

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
      // 404 by design on non-owned sessions.
      await assertOwnership(ctx, "session", id);
    } catch (err) {
      if (err instanceof OwnershipError) {
        return new Response("Not Found", { status: 404 });
      }
      throw err;
    }

    const [event] = await db
      .select({
        event: schema.syncedTransactionEvents,
        ocppTag: schema.userMappings.steveOcppIdTag,
        ocppTagPk: schema.userMappings.steveOcppTagPk,
        mappingId: schema.userMappings.id,
        mappingDisplayName: schema.userMappings.displayName,
      })
      .from(schema.syncedTransactionEvents)
      .leftJoin(
        schema.userMappings,
        eq(
          schema.syncedTransactionEvents.userMappingId,
          schema.userMappings.id,
        ),
      )
      .where(eq(schema.syncedTransactionEvents.id, id))
      .limit(1);
    if (!event) {
      return new Response("Not Found", { status: 404 });
    }

    // Pull the rest of the timeline (events sharing the StEvE transaction id).
    const timelineRaw = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .where(
        and(
          eq(
            schema.syncedTransactionEvents.steveTransactionId,
            event.event.steveTransactionId,
          ),
          eq(
            schema.syncedTransactionEvents.userMappingId,
            event.event.userMappingId!,
          ),
        ),
      )
      .orderBy(asc(schema.syncedTransactionEvents.syncedAt));

    const timeline: MeterRow[] = timelineRaw.map((r) => ({
      id: r.id,
      syncedAt: r.syncedAt ? r.syncedAt.toISOString() : null,
      kwhDelta: r.kwhDelta as unknown as string,
      meterValueFrom: r.meterValueFrom,
      meterValueTo: r.meterValueTo,
      isFinal: r.isFinal ?? false,
    }));

    // Sync state — needed for `isFinalized` (live indicator) + total kWh.
    const [syncState] = await db
      .select()
      .from(schema.transactionSyncState)
      .where(
        eq(
          schema.transactionSyncState.steveTransactionId,
          event.event.steveTransactionId,
        ),
      )
      .limit(1);

    const isLive = !syncState?.isFinalized;

    // Best-effort StEvE enrichment for live sessions — we want chargeBoxId,
    // connectorId, startTimestamp for the LiveSessionCard. Failures here are
    // non-fatal: the rest of the page still renders.
    let liveChargeBoxId: string | null = null;
    let liveConnectorId: number | null = null;
    let liveStartedAt: string | null = null;
    if (isLive) {
      try {
        const [steveTx] = await steveClient.getTransactions({
          transactionPk: event.event.steveTransactionId,
          type: "ACTIVE",
          periodType: "ALL",
        });
        if (steveTx) {
          liveChargeBoxId = steveTx.chargeBoxId;
          liveConnectorId = steveTx.connectorId;
          liveStartedAt = steveTx.startTimestamp;
        }
      } catch (error) {
        log.warn(
          "StEvE lookup for live customer session failed — rendering without chargeBoxId",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    // Aggregates for the SessionDetailCard tiles.
    const [agg] = await db
      .select({
        totalKwh: sql<
          number
        >`COALESCE(SUM(${schema.syncedTransactionEvents.kwhDelta}), 0)`,
        firstAt: sql<
          Date | null
        >`MIN(${schema.syncedTransactionEvents.syncedAt})`,
        lastAt: sql<
          Date | null
        >`MAX(${schema.syncedTransactionEvents.syncedAt})`,
      })
      .from(schema.syncedTransactionEvents)
      .where(
        and(
          eq(
            schema.syncedTransactionEvents.steveTransactionId,
            event.event.steveTransactionId,
          ),
          eq(
            schema.syncedTransactionEvents.userMappingId,
            event.event.userMappingId!,
          ),
        ),
      );

    const totalKwh = Number(agg?.totalKwh ?? 0);
    // Prefer StEvE's `startTimestamp` for live sessions (more accurate than
    // first synced event); fall back to the first sync timestamp otherwise.
    const startTime = liveStartedAt
      ? new Date(liveStartedAt)
      : agg?.firstAt
      ? new Date(agg.firstAt)
      : null;
    const endTime = isLive
      ? new Date()
      : agg?.lastAt
      ? new Date(agg.lastAt)
      : null;
    const totalDurationSeconds = startTime && endTime
      ? Math.max(
        0,
        Math.floor((endTime.getTime() - startTime.getTime()) / 1000),
      )
      : null;
    const avgKw = totalDurationSeconds && totalDurationSeconds > 0
      ? (totalKwh / (totalDurationSeconds / 3600))
      : null;

    return {
      data: {
        sessionId: id,
        steveTransactionId: event.event.steveTransactionId,
        ocppTag: event.ocppTag ?? null,
        ocppTagMappingId: event.mappingId ?? null,
        mappingDisplayName: event.mappingDisplayName ?? null,
        kwhDelta: event.event.kwhDelta as unknown as string,
        meterValueFrom: event.event.meterValueFrom,
        meterValueTo: event.event.meterValueTo,
        isFinal: event.event.isFinal ?? false,
        syncedAt: event.event.syncedAt
          ? event.event.syncedAt.toISOString()
          : null,
        timeline,
        isLive,
        totalKwh,
        totalDurationSeconds,
        avgKw,
        // Cost wiring is handed off to G3 (billing) — surfaced as null here
        // until that track lands the Lago-side resolver.
        costCents: null,
        costCurrency: null,
        invoiceId: null,
        liveChargeBoxId,
        liveConnectorId,
        liveStartedAt,
        liveInitialKwh: totalKwh,
      },
    };
  },
});

export default define.page<typeof handler>(
  function CustomerSessionDetailPage({ data, url, state }) {
    const status = data.isLive
      ? "in_progress" as const
      : data.isFinal
      ? "completed" as const
      : "in_progress" as const;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="green"
        role="customer"
        actions={<BackAction href="/sessions" />}
      >
        <div class="space-y-6">
          <PageCard
            title={`Session #${data.steveTransactionId}`}
            description={data.syncedAt
              ? `Last activity ${new Date(data.syncedAt).toLocaleString()}`
              : undefined}
            colorScheme="green"
            headerActions={<TransactionStatusBadge status={status} large />}
          >
            <div class="space-y-6">
              {data.isLive && (
                <LiveSessionCard
                  steveTransactionId={data.steveTransactionId}
                  chargeBoxId={data.liveChargeBoxId}
                  connectorId={data.liveConnectorId}
                  initialKwh={data.liveInitialKwh}
                  startedAt={data.liveStartedAt}
                  isAdmin={false}
                />
              )}

              <SessionDetailCard
                session={{
                  id: data.sessionId,
                  steveTransactionId: data.steveTransactionId,
                  ocppTag: data.ocppTag,
                  ocppTagMappingId: data.ocppTagMappingId,
                  mappingDisplayName: data.mappingDisplayName,
                  kwhDelta: data.kwhDelta,
                  meterValueFrom: data.meterValueFrom,
                  meterValueTo: data.meterValueTo,
                  isFinal: data.isFinal,
                  syncedAt: data.syncedAt,
                }}
                totalKwh={data.totalKwh}
                totalDurationSeconds={data.totalDurationSeconds}
                avgKw={data.avgKw}
                costCents={data.costCents}
                costCurrency={data.costCurrency}
                invoiceId={data.invoiceId}
                chargeBoxId={data.liveChargeBoxId}
                connectorId={data.liveConnectorId}
              />

              <SectionCard
                title="Meter timeline"
                description={`${data.timeline.length} reading${
                  data.timeline.length === 1 ? "" : "s"
                }`}
                icon={Activity}
                accent="green"
              >
                <SessionMeterTimeline rows={data.timeline} />
              </SectionCard>
            </div>
          </PageCard>
        </div>
      </SidebarLayout>
    );
  },
);
