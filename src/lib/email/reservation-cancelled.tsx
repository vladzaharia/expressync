/**
 * Reservation-cancelled email — sent when a customer's reservation is
 * cancelled either by them or by an admin.
 *
 * Optional `reason` is rendered as a highlight block when present.
 */

import type { EmailTemplate, MetadataRow } from "./types.ts";

export interface ReservationData {
  /** Operator-friendly charger label, e.g. "Polaris HQ — Bay 2". */
  chargerName: string;
  /** Human-readable reservation date, e.g. "Apr 22, 2026". */
  date: string;
  /** Human-readable reservation time, e.g. "14:00 – 15:00". */
  time: string;
}

export interface ReservationCancelledInputs {
  to: string;
  reservation: ReservationData;
  reason?: string;
}

export function buildReservationCancelledEmail(
  inputs: ReservationCancelledInputs,
): EmailTemplate {
  const { reservation, reason } = inputs;
  const metadata: MetadataRow[] = [
    { label: "Charger", value: reservation.chargerName },
    { label: "Date", value: reservation.date },
    { label: "Time", value: reservation.time },
  ];

  const body: EmailTemplate["body"] = [
    {
      type: "paragraph",
      text:
        `Your reservation at ${reservation.chargerName} on ${reservation.date} has been cancelled.`,
    },
  ];
  if (reason && reason.length > 0) {
    body.push({ type: "highlight", text: `Reason: ${reason}` });
  }

  return {
    brand: "polaris",
    category: "reservation-cancelled",
    subject: "Reservation cancelled",
    preheader: buildPreheader(reservation.chargerName, reservation.date),
    title: "Reservation cancelled",
    body,
    metadata,
    cta: {
      label: "Make another reservation",
      url: "https://polaris.express/reservations/new",
      variant: "primary",
    },
  };
}

/**
 * Build a preheader within the 40–110 char window. Always pads with the
 * canonical CTA copy so short charger/date strings don't fall short.
 */
function buildPreheader(chargerName: string, date: string): string {
  const base =
    `Your reservation at ${chargerName} on ${date} has been cancelled — book another time below.`;
  if (base.length <= 110) return base;
  return base.slice(0, 109) + "…";
}
