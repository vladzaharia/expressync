/**
 * Reservation detail — <PageCard colorScheme="indigo"> + status pill row.
 *
 * Renders a 2-col split at `lg:`: left = mini timeline, right = chips + audit.
 * The ReservationDetail island owns Reschedule + Cancel actions.
 */

import { define } from "../../utils.ts";
import { desc, eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { BatteryCharging, Tag as TagIcon, User } from "lucide-preact";
import { BackAction } from "../../components/shared/BackAction.tsx";
import {
  type Pill,
  StatusPillRow,
} from "../../components/tags/StatusPillRow.tsx";
import { ReservationStatusChip } from "../../components/reservations/ReservationStatusChip.tsx";
import { TimeRangePill } from "../../components/reservations/TimeRangePill.tsx";
import ReservationDetail from "../../islands/reservations/ReservationDetail.tsx";
import type { ReservationStatus } from "../../src/db/schema.ts";

interface AuditRow {
  id: number;
  operation: string;
  status: string;
  createdAtIso: string;
  completedAtIso: string | null;
}

interface ReservationDetailData {
  reservation: {
    id: number;
    chargeBoxId: string;
    connectorId: number;
    ocppTagPk: number;
    ocppTagId: string;
    lagoSubscriptionExternalId: string | null;
    startAtIso: string;
    endAtIso: string;
    durationMinutes: number;
    status: ReservationStatus;
    steveReservationId: number | null;
    chargingProfileTaskId: number | null;
    createdAtIso: string;
    updatedAtIso: string;
    cancelledAtIso: string | null;
    createdByUserEmail: string | null;
  };
  audit: AuditRow[];
}

export const handler = define.handlers({
  async GET(ctx) {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return ctx.redirect("/reservations");

    const [row] = await db
      .select()
      .from(schema.reservations)
      .where(eq(schema.reservations.id, id))
      .limit(1);
    if (!row) return ctx.redirect("/reservations");

    // Look up createdBy email (best-effort).
    let createdByUserEmail: string | null = null;
    if (row.createdByUserId) {
      const [u] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, row.createdByUserId))
        .limit(1);
      createdByUserEmail = u?.email ?? null;
    }

    // Audit: any charger operations that reference this reservation via its
    // task ids. We pull by taskId match (best-effort).
    const audit: AuditRow[] = [];
    if (row.steveReservationId || row.chargingProfileTaskId) {
      try {
        const rows = await db
          .select()
          .from(schema.chargerOperationLog)
          .where(eq(schema.chargerOperationLog.chargeBoxId, row.chargeBoxId))
          .orderBy(desc(schema.chargerOperationLog.createdAt))
          .limit(25);
        for (const r of rows) {
          if (
            r.taskId === row.steveReservationId ||
            r.taskId === row.chargingProfileTaskId
          ) {
            audit.push({
              id: r.id,
              operation: r.operation,
              status: r.status,
              createdAtIso: (r.createdAt ?? new Date()).toISOString(),
              completedAtIso: r.completedAt
                ? r.completedAt.toISOString()
                : null,
            });
          }
        }
      } catch (_err) {
        // Non-fatal
      }
    }

    return {
      data: {
        reservation: {
          id: row.id,
          chargeBoxId: row.chargeBoxId,
          connectorId: row.connectorId,
          ocppTagPk: row.steveOcppTagPk,
          ocppTagId: row.steveOcppIdTag,
          lagoSubscriptionExternalId: row.lagoSubscriptionExternalId,
          startAtIso: (row.startAt ?? new Date()).toISOString(),
          endAtIso: (row.endAt ?? new Date()).toISOString(),
          durationMinutes: row.durationMinutes,
          status: row.status as ReservationStatus,
          steveReservationId: row.steveReservationId,
          chargingProfileTaskId: row.chargingProfileTaskId,
          createdAtIso: (row.createdAt ?? new Date()).toISOString(),
          updatedAtIso: (row.updatedAt ?? new Date()).toISOString(),
          cancelledAtIso: row.cancelledAt
            ? row.cancelledAt.toISOString()
            : null,
          createdByUserEmail,
        },
        audit,
      } satisfies ReservationDetailData,
    };
  },
});

export default define.page<typeof handler>(
  function ReservationDetailPage({ data, url, state }) {
    const r = data.reservation;

    const statusToTone = (status: ReservationStatus): Pill["tone"] => {
      switch (status) {
        case "active":
          return "emerald";
        case "pending":
          return "amber";
        case "confirmed":
          return "cyan";
        case "conflicted":
          return "rose";
        case "orphaned":
          return "sky";
        default:
          return "muted";
      }
    };

    const pills: Pill[] = [
      {
        label: r.status.charAt(0).toUpperCase() + r.status.slice(1),
        tone: statusToTone(r.status),
        live: true,
      },
      {
        label: r.chargeBoxId,
        tone: "orange",
        icon: <BatteryCharging class="size-3.5" aria-hidden="true" />,
        title: "Charger",
      },
      {
        label: r.connectorId === 0
          ? "All connectors"
          : `Connector #${r.connectorId}`,
        tone: "neutral",
      },
      {
        label: r.ocppTagId,
        tone: "cyan",
        icon: <TagIcon class="size-3.5" aria-hidden="true" />,
        title: "OCPP tag",
      },
    ];
    if (r.lagoSubscriptionExternalId) {
      pills.push({
        label: r.lagoSubscriptionExternalId,
        tone: "violet",
        title: "Lago subscription",
      });
    } else {
      pills.push({
        label: "No subscription",
        tone: "muted",
        dashed: true,
      });
    }

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="indigo"
        actions={
          <BackAction href="/reservations" className="hover:bg-muted/40" />
        }
      >
        <PageCard
          title={`Reservation #${r.id}`}
          description={`Created ${new Date(r.createdAtIso).toLocaleString()}`}
          colorScheme="indigo"
        >
          <div class="flex flex-col gap-6">
            <StatusPillRow pills={pills} />

            <div class="grid gap-6 lg:grid-cols-2">
              {/* Left: mini timeline */}
              <div class="rounded-md border bg-background p-4">
                <h3 class="mb-3 text-sm font-semibold">Timeline</h3>
                <div class="flex flex-col gap-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-muted-foreground">Window</span>
                    <TimeRangePill
                      startAtIso={r.startAtIso}
                      endAtIso={r.endAtIso}
                    />
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-muted-foreground">Duration</span>
                    <span>{r.durationMinutes} min</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-muted-foreground">Status</span>
                    <ReservationStatusChip status={r.status} large />
                  </div>
                  {r.cancelledAtIso && (
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-muted-foreground">Cancelled</span>
                      <span>
                        {new Date(r.cancelledAtIso).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
                <p class="mt-3 text-xs text-muted-foreground">
                  Times shown in your local timezone. Charger-local tz will be
                  used once charger metadata carries it.
                </p>
              </div>

              {/* Right: chips + audit */}
              <div class="flex flex-col gap-4">
                <div class="rounded-md border bg-background p-4">
                  <h3 class="mb-3 text-sm font-semibold">Integration</h3>
                  <dl class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                        StEvE reservation id
                      </dt>
                      <dd class="font-mono">{r.steveReservationId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                        Profile task id
                      </dt>
                      <dd class="font-mono">
                        {r.chargingProfileTaskId ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div class="rounded-md border bg-background p-4">
                  <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <User class="size-4" /> Audit
                  </h3>
                  <dl class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                        Created by
                      </dt>
                      <dd class="truncate">{r.createdByUserEmail ?? "—"}</dd>
                    </div>
                    <div>
                      <dt class="text-xs uppercase tracking-wide text-muted-foreground">
                        Updated
                      </dt>
                      <dd>{new Date(r.updatedAtIso).toLocaleString()}</dd>
                    </div>
                  </dl>

                  {data.audit.length > 0 && (
                    <ul class="mt-3 divide-y border-t text-xs">
                      {data.audit.map((a) => (
                        <li
                          key={a.id}
                          class="flex items-center justify-between gap-3 py-2"
                        >
                          <span class="font-mono">{a.operation}</span>
                          <span class="text-muted-foreground">
                            {a.status} ·{" "}
                            {new Date(a.createdAtIso).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Action row */}
            <div class="flex flex-col gap-3 border-t pt-4">
              <ReservationDetail
                reservationId={r.id}
                status={r.status}
                startAtIso={r.startAtIso}
                endAtIso={r.endAtIso}
              />
            </div>
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
