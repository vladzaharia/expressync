import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc, eq } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
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
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Tag,
  Zap,
} from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const steveTransactionId = parseInt(ctx.params.id);
    if (isNaN(steveTransactionId)) {
      return ctx.renderNotFound();
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

    return {
      data: {
        steveTransactionId,
        syncState,
        billingEvents,
        syncRuns,
      },
    };
  },
});

function BackAction() {
  return (
    <a
      href="/transactions"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(function TransactionDetailsPage({
  data,
  url,
  state,
}) {
  const { steveTransactionId, syncState, billingEvents } = data;
  const ocppTagId = billingEvents[0]?.ocppTagId ?? "Unknown";

  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      accentColor="green"
      actions={<BackAction />}
    >
      <div className="space-y-6">
        {/* Transaction Info Card */}
        <PageCard title="Transaction Overview" colorScheme="green">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transaction ID</p>
                <p className="font-mono font-semibold">{steveTransactionId}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Tag className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">OCPP Tag</p>
                <p className="font-mono font-semibold">{ocppTagId}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10">
                <Activity className="size-5 text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Total kWh Billed
                </p>
                <p className="font-semibold tabular-nums">
                  {(syncState?.totalKwhBilled ?? 0).toFixed(2)} kWh
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                {syncState?.isFinalized
                  ? <CheckCircle2 className="size-5 text-success" />
                  : <Clock className="size-5 text-warning" />}
              </div>
              <div>
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
        </PageCard>

        {/* Billing Events Table */}
        <PageCard
          title="Billing Events"
          description={`${billingEvents.length} event${
            billingEvents.length !== 1 ? "s" : ""
          } sent to Lago`}
          colorScheme="green"
        >
          <BillingEventsTable events={billingEvents} />
        </PageCard>
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
