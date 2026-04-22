import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc, eq } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.tsx";
import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock,
  Receipt,
  Tag,
  Zap,
} from "lucide-preact";
import { BackAction } from "../../components/shared/BackAction.tsx";
import { MetricTile } from "../../components/shared/MetricTile.tsx";
import LiveSessionCard from "../../islands/charging-sessions/LiveSessionCard.tsx";
import { steveClient } from "../../src/lib/steve-client.ts";
import { logger } from "../../src/lib/utils/logger.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const steveTransactionId = parseInt(ctx.params.id);
    if (isNaN(steveTransactionId)) {
      return new Response("Not Found", { status: 404 });
    }

    // Get transaction sync state
    const [syncState] = await db
      .select()
      .from(schema.transactionSyncState)
      .where(
        eq(schema.transactionSyncState.steveTransactionId, steveTransactionId),
      )
      .limit(1);

    // Get all billing events for this transaction
    const billingEvents = await db
      .select()
      .from(schema.syncedTransactionEvents)
      .where(
        eq(
          schema.syncedTransactionEvents.steveTransactionId,
          steveTransactionId,
        ),
      )
      .orderBy(desc(schema.syncedTransactionEvents.syncedAt));

    // Get unique sync run IDs from billing events
    const syncRunIds = [
      ...new Set(billingEvents.map((e) => e.syncRunId).filter(Boolean)),
    ];

    // Get sync runs
    const syncRuns = syncRunIds.length > 0
      ? await db
        .select()
        .from(schema.syncRuns)
        .where(eq(schema.syncRuns.id, syncRunIds[0]!))
      : [];

    // Resolve the OCPP tag + PK via user mapping. We look up once using the
    // first billing event's mapping; if the session has no events yet (common
    // for freshly-started live sessions) we'll fall back to StEvE below.
    const firstMappingId = billingEvents[0]?.userMappingId;
    let ocppTagId: string | null = null;
    let ocppTagPk: number | null = null;
    if (firstMappingId) {
      const [mapping] = await db
        .select({
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
          steveOcppTagPk: schema.userMappings.steveOcppTagPk,
        })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.id, firstMappingId))
        .limit(1);
      if (mapping) {
        ocppTagId = mapping.steveOcppIdTag;
        ocppTagPk = mapping.steveOcppTagPk;
      }
    }

    // Live-session enrichment — only when not yet finalized. Fetch the StEvE
    // row so we can surface chargeBoxId + startTimestamp to the island. If
    // StEvE is unreachable we still render the live card with the fields we
    // already have.
    const isLive = !syncState?.isFinalized;
    let liveChargeBoxId: string | null = null;
    let liveConnectorId: number | null = null;
    let liveStartedAt: string | null = null;
    const liveInitialKwh = Number(syncState?.totalKwhBilled ?? 0);
    if (isLive) {
      try {
        const [steveTx] = await steveClient.getTransactions({
          transactionPk: steveTransactionId,
          type: "ACTIVE",
          periodType: "ALL",
        });
        if (steveTx) {
          liveChargeBoxId = steveTx.chargeBoxId;
          liveConnectorId = steveTx.connectorId;
          liveStartedAt = steveTx.startTimestamp;
          // If we still have no tag mapping from billing events, take the
          // ocppIdTag from StEvE so the overview tile renders something
          // meaningful; the tagPk cross-link will only activate if we can
          // resolve a mapping below.
          if (!ocppTagId) {
            ocppTagId = steveTx.ocppIdTag;
          }
          // Best-effort tagPk resolution (so the OCPP Tag value can link).
          if (!ocppTagPk && steveTx.ocppIdTag) {
            try {
              const [mapping] = await db
                .select({
                  steveOcppTagPk: schema.userMappings.steveOcppTagPk,
                })
                .from(schema.userMappings)
                .where(
                  eq(schema.userMappings.steveOcppIdTag, steveTx.ocppIdTag),
                )
                .limit(1);
              if (mapping) ocppTagPk = mapping.steveOcppTagPk;
            } catch {
              // Non-fatal — link just won't render.
            }
          }
        }
      } catch (error) {
        logger.warn(
          "TransactionDetail",
          "StEvE lookup for live session failed — rendering card without chargeBoxId",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    const isAdmin = ctx.state.user?.role === "admin";

    return {
      data: {
        steveTransactionId,
        syncState,
        billingEvents,
        syncRuns,
        ocppTagId,
        ocppTagPk,
        isLive,
        liveChargeBoxId,
        liveConnectorId,
        liveStartedAt,
        liveInitialKwh,
        isAdmin,
      },
    };
  },
});

export default define.page<typeof handler>(function TransactionDetailsPage({
  data,
  url,
  state,
}) {
  const {
    steveTransactionId,
    syncState,
    billingEvents,
    ocppTagId: resolvedOcppTagId,
    ocppTagPk,
    isLive,
    liveChargeBoxId,
    liveConnectorId,
    liveStartedAt,
    liveInitialKwh,
    isAdmin,
  } = data;
  const ocppTagId = resolvedOcppTagId ?? "Unknown";

  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      accentColor="green"
      actions={<BackAction href="/transactions" />}
    >
      <div className="space-y-6">
        {/* Live session card — only for in-progress sessions. */}
        {isLive && (
          <LiveSessionCard
            steveTransactionId={steveTransactionId}
            chargeBoxId={liveChargeBoxId}
            connectorId={liveConnectorId}
            initialKwh={liveInitialKwh}
            startedAt={liveStartedAt}
            isAdmin={isAdmin}
          />
        )}

        {/* Charging Session Info Card */}
        <PageCard title="Charging Session Overview" colorScheme="green">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
            <MetricTile
              icon={Zap}
              label="Session ID"
              value={<span className="font-mono">{steveTransactionId}</span>}
              accent="blue"
            />
            <MetricTile
              icon={Tag}
              label="OCPP Tag"
              value={ocppTagPk && resolvedOcppTagId
                ? (
                  <a
                    href={`/tags/${ocppTagPk}`}
                    className="font-mono hover:underline"
                  >
                    {ocppTagId}
                  </a>
                )
                : <span className="font-mono">{ocppTagId}</span>}
              accent="cyan"
            />
            <MetricTile
              icon={Activity}
              label="Total kWh Billed"
              value={
                <span className="tabular-nums">
                  {Number(syncState?.totalKwhBilled ?? 0).toFixed(2)} kWh
                </span>
              }
              accent="green"
            />
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted shrink-0">
                {syncState?.isFinalized
                  ? <CheckCircle2 className="size-5 text-success" />
                  : <Clock className="size-5 text-warning" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Status</p>
                {syncState?.isFinalized
                  ? (
                    <Badge
                      variant="outline"
                      className="text-success border-success/30 bg-success/10"
                    >
                      Complete
                    </Badge>
                  )
                  : (
                    <Badge
                      variant="outline"
                      className="text-warning border-warning/30 bg-warning/10"
                    >
                      In Progress
                    </Badge>
                  )}
              </div>
            </div>
          </div>
          {liveChargeBoxId && (
            <p className="mt-4 text-xs text-muted-foreground">
              Charger:{" "}
              <a
                href={`/chargers/${encodeURIComponent(liveChargeBoxId)}`}
                className="font-mono hover:underline"
              >
                {liveChargeBoxId}
              </a>
              {liveConnectorId != null && (
                <span>· Connector {liveConnectorId}</span>
              )}
            </p>
          )}
        </PageCard>

        <SectionCard
          title="Billing events"
          description={`${billingEvents.length} event${
            billingEvents.length !== 1 ? "s" : ""
          } sent to Lago`}
          icon={Receipt}
          accent="green"
        >
          <BillingEventsTable events={billingEvents} />
        </SectionCard>
      </div>
    </SidebarLayout>
  );
});

interface BillingEventsTableProps {
  events: schema.SyncedTransactionEvent[];
}

function BillingEventsTable({ events }: BillingEventsTableProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Calendar className="size-8 opacity-50" />
        <p>No billing events yet</p>
        <p className="text-xs">Events will appear here after syncing</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lago Event ID</TableHead>
          <TableHead className="text-right">kWh Delta</TableHead>
          <TableHead className="text-right">Meter From</TableHead>
          <TableHead className="text-right">Meter To</TableHead>
          <TableHead>Final</TableHead>
          <TableHead>Synced At</TableHead>
          <TableHead>Sync Run</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="font-mono text-xs">
              {event.lagoEventTransactionId}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {((event.meterValueTo - event.meterValueFrom) / 1000).toFixed(3)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground text-sm">
              {(event.meterValueFrom / 1000).toFixed(3)} kWh
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground text-sm">
              {(event.meterValueTo / 1000).toFixed(3)} kWh
            </TableCell>
            <TableCell>
              {event.isFinal
                ? (
                  <Badge
                    variant="outline"
                    className="text-success border-success/30 bg-success/10"
                  >
                    Yes
                  </Badge>
                )
                : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {event.syncedAt ? new Date(event.syncedAt).toLocaleString() : "—"}
            </TableCell>
            <TableCell>
              {event.syncRunId
                ? (
                  <a
                    href={`/sync/${event.syncRunId}`}
                    className="text-primary hover:underline text-sm"
                  >
                    #{event.syncRunId}
                  </a>
                )
                : <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
