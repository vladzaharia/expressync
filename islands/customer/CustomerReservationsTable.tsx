/**
 * CustomerReservationsTable — customer-scoped list view of reservations.
 *
 * Polaris Track G3 — list-mode counterpart to `ReservationCalendar`. Mirrors
 * the desktop column set but adds `renderMobileCard` so `<md` viewports
 * collapse rows to stacked tap-cards. Selecting a row navigates to
 * `/reservations/[id]`.
 *
 * Desktop columns:
 *   When · Window · Charger · Status
 *
 * Mobile card:
 *   topLeft       = "Mon, 22 Apr"
 *   topRight      = ReservationStatusBadge
 *   secondaryLine = chargeBoxId · connector
 *   primaryStat   = "10:00 → 11:30"
 *   secondaryStat = duration ("90 min")
 */

import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import { ReservationStatusBadge } from "@/components/shared/ReservationStatusBadge.tsx";
import { MobileCardRow } from "@/components/shared/MobileCardRow.tsx";
import type { ReservationRowDTO } from "@/src/db/schema.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  reservations: ReservationRowDTO[];
  totalCount?: number;
  pageSize?: number;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
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

function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "—";
  }
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export default function CustomerReservationsTable(
  { reservations, totalCount, pageSize = 25 }: Props,
) {
  const columns: PaginatedTableColumn<ReservationRowDTO>[] = [
    {
      key: "when",
      header: "When",
      render: (row) => (
        <span className="text-sm font-medium">{formatDay(row.startAtIso)}</span>
      ),
    },
    {
      key: "window",
      header: "Window",
      render: (row) => (
        <span className="text-sm tabular-nums">
          {formatTime(row.startAtIso)} → {formatTime(row.endAtIso)}
        </span>
      ),
    },
    {
      key: "charger",
      header: "Charger",
      hideOnMobile: true,
      render: (row) => (
        <span className="font-mono text-sm text-muted-foreground">
          {row.chargeBoxId}
          {row.connectorId !== 0 && (
            <span className="ml-1 text-xs">· #{row.connectorId}</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <ReservationStatusBadge status={row.status} />,
    },
  ];

  const renderMobileCard = (row: ReservationRowDTO) => (
    <MobileCardRow
      topLeft={formatDay(row.startAtIso)}
      topRight={<ReservationStatusBadge status={row.status} />}
      secondaryLine={
        <span className="font-mono">
          {row.chargeBoxId}
          {row.connectorId !== 0 && (
            <span className="ml-1">· #{row.connectorId}</span>
          )}
        </span>
      }
      primaryStat={
        <span className="tabular-nums">
          {formatTime(row.startAtIso)} → {formatTime(row.endAtIso)}
        </span>
      }
      secondaryStat={formatDuration(row.startAtIso, row.endAtIso)}
    />
  );

  return (
    <PaginatedTable<ReservationRowDTO>
      initialItems={reservations}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      getItemKey={(row) => row.id}
      onRowClick={(row) => {
        clientNavigate(`/reservations/${row.id}`);
      }}
      emptyMessage="No reservations match the current filter"
      renderMobileCard={renderMobileCard}
    />
  );
}
