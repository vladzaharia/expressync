/**
 * /reservations/[id] — customer reservation detail.
 *
 * Polaris Track G3 — read + cancel surface for one of the customer's own
 * reservations. Loader runs `assertOwnership("reservation", id)` first;
 * non-owners get a 404-style "not found" PageCard rather than redirected.
 *
 * Layout:
 *   PageCard (indigo, BackAction → /reservations)
 *     Header actions: ReservationStatusBadge + Cancel button (island)
 *     SectionCard "Summary" — MetricTiles (date, time, duration, charger,
 *       card cross-link to /cards/[tagPk])
 *     SectionCard "Resulting session" — visible only when the reservation
 *       has a chargingProfileTaskId AND we found a matching transaction;
 *       cross-links to /sessions/[id].
 */

import { define } from "../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import { BackAction } from "../../components/shared/BackAction.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
import { MetricTile } from "../../components/shared/MetricTile.tsx";
import { ReservationStatusBadge } from "../../components/shared/ReservationStatusBadge.tsx";
import {
  BatteryCharging,
  Calendar,
  Clock,
  CreditCard,
  Receipt,
  Timer,
} from "lucide-preact";
import CustomerReservationActions from "../../islands/customer/CustomerReservationActions.tsx";
import {
  assertOwnership,
  OwnershipError,
  resolveCustomerScope,
} from "../../src/lib/scoping.ts";
import { logger } from "../../src/lib/utils/logger.ts";
import type { ReservationStatus } from "../../src/db/schema.ts";

const log = logger.child("CustomerReservationDetailPage");

interface LoaderData {
  reservation: {
    id: number;
    chargeBoxId: string;
    connectorId: number;
    ocppTagPk: number;
    ocppTagId: string;
    startAtIso: string;
    endAtIso: string;
    durationMinutes: number;
    status: ReservationStatus;
    cancelledAtIso: string | null;
    chargingProfileTaskId: number | null;
  } | null;
  cardLabel: string | null;
  resultingSessionId: number | null;
  errorMessage: string | null;
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const id = parseId(ctx.params.id);
    if (id === null) {
      return {
        data: {
          reservation: null,
          cardLabel: null,
          resultingSessionId: null,
          errorMessage: "Invalid reservation id",
        } satisfies LoaderData,
      };
    }

    try {
      await assertOwnership(ctx, "reservation", id);
      const scope = await resolveCustomerScope(ctx);

      const [row] = await db
        .select()
        .from(schema.reservations)
        .where(eq(schema.reservations.id, id))
        .limit(1);

      if (!row) {
        return {
          data: {
            reservation: null,
            cardLabel: null,
            resultingSessionId: null,
            errorMessage: "Reservation not found",
          } satisfies LoaderData,
        };
      }

      // Lookup the card displayName for the cross-link.
      let cardLabel: string | null = null;
      if (scope.mappingIds.length > 0) {
        const [mapping] = await db
          .select({
            displayName: schema.userMappings.displayName,
            ocppIdTag: schema.userMappings.steveOcppIdTag,
          })
          .from(schema.userMappings)
          .where(eq(schema.userMappings.steveOcppTagPk, row.steveOcppTagPk))
          .limit(1);
        cardLabel = mapping?.displayName ?? mapping?.ocppIdTag ?? null;
      }

      // The "resulting session" cross-link is intentionally skipped in
      // MVP: synced_transaction_events has no `charge_box_id` column to
      // join against, so we'd need a richer schema (or a service-layer
      // linker) to resolve which session came out of which reservation.
      // The SectionCard below renders only when this is non-null.
      const resultingSessionId: number | null = null;

      return {
        data: {
          reservation: {
            id: row.id,
            chargeBoxId: row.chargeBoxId,
            connectorId: row.connectorId,
            ocppTagPk: row.steveOcppTagPk,
            ocppTagId: row.steveOcppIdTag,
            startAtIso: (row.startAt ?? new Date()).toISOString(),
            endAtIso: (row.endAt ?? new Date()).toISOString(),
            durationMinutes: row.durationMinutes,
            status: row.status as ReservationStatus,
            cancelledAtIso: row.cancelledAt
              ? row.cancelledAt.toISOString()
              : null,
            chargingProfileTaskId: row.chargingProfileTaskId,
          },
          cardLabel,
          resultingSessionId,
          errorMessage: null,
        } satisfies LoaderData,
      };
    } catch (err) {
      if (err instanceof OwnershipError) {
        return {
          data: {
            reservation: null,
            cardLabel: null,
            resultingSessionId: null,
            errorMessage: "Reservation not found",
          } satisfies LoaderData,
        };
      }
      log.error("Failed to load reservation detail", err as Error);
      return {
        data: {
          reservation: null,
          cardLabel: null,
          resultingSessionId: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        } satisfies LoaderData,
      };
    }
  },
});

export default define.page<typeof handler>(
  function CustomerReservationDetailPage({ data, url, state }) {
    const r = data.reservation;
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        role="customer"
        accentColor="indigo"
        actions={<BackAction href="/reservations" />}
      >
        {r
          ? (
            <PageCard
              title={`Reservation #${r.id}`}
              description={`Booked for ${formatDate(r.startAtIso)}`}
              colorScheme="indigo"
              headerActions={
                <div class="flex items-center gap-2">
                  <ReservationStatusBadge status={r.status} />
                  <CustomerReservationActions
                    reservationId={r.id}
                    status={r.status}
                  />
                </div>
              }
            >
              <div class="flex flex-col gap-6">
                <SectionCard
                  title="Summary"
                  icon={Calendar}
                  accent="indigo"
                >
                  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <MetricTile
                      icon={Calendar}
                      label="Date"
                      value={formatDate(r.startAtIso)}
                      accent="indigo"
                    />
                    <MetricTile
                      icon={Clock}
                      label="Time"
                      value={
                        <span class="tabular-nums">
                          {formatTime(r.startAtIso)} → {formatTime(r.endAtIso)}
                        </span>
                      }
                      accent="indigo"
                    />
                    <MetricTile
                      icon={Timer}
                      label="Duration"
                      value={formatDuration(r.durationMinutes)}
                      accent="indigo"
                    />
                    <MetricTile
                      icon={BatteryCharging}
                      label="Charger"
                      value={
                        <span class="font-mono">
                          {r.chargeBoxId}
                          {r.connectorId !== 0 && (
                            <span class="ml-1 text-xs">· #{r.connectorId}</span>
                          )}
                        </span>
                      }
                      sublabel={r.connectorId === 0
                        ? "All connectors"
                        : undefined}
                      accent="indigo"
                    />
                    <MetricTile
                      icon={CreditCard}
                      label="Card"
                      value={
                        <a
                          href={`/cards/${r.ocppTagPk}`}
                          class="text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {data.cardLabel ?? r.ocppTagId}
                        </a>
                      }
                      sublabel={data.cardLabel ? r.ocppTagId : undefined}
                      accent="indigo"
                    />
                    {r.cancelledAtIso && (
                      <MetricTile
                        icon={Clock}
                        label="Cancelled"
                        value={new Date(r.cancelledAtIso).toLocaleString()}
                        accent="indigo"
                      />
                    )}
                  </div>
                </SectionCard>

                {data.resultingSessionId !== null && (
                  <SectionCard
                    title="Resulting session"
                    icon={Receipt}
                    accent="indigo"
                  >
                    <p class="text-sm">
                      A charging session was created from this reservation.{" "}
                      <a
                        href={`/sessions/${data.resultingSessionId}`}
                        class="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        View session →
                      </a>
                    </p>
                  </SectionCard>
                )}
              </div>
            </PageCard>
          )
          : (
            <PageCard
              title="Reservation not found"
              description={data.errorMessage ??
                "We couldn't find that reservation on your account."}
              colorScheme="indigo"
            >
              <p class="text-sm text-muted-foreground">
                <a href="/reservations" class="text-indigo-600 hover:underline">
                  Return to reservations
                </a>
              </p>
            </PageCard>
          )}
      </SidebarLayout>
    );
  },
);
