/**
 * Session-summary email — sent when a customer's charging session ends.
 *
 * The cost-transparency email — fires on every session.complete event.
 * If cost is not yet computed at send-time, omit the row and surface a
 * reassuring note in the footer.
 *
 * Track H wires this into `notification.service.ts`'s session.complete hook.
 */

import type { EmailTemplate, MetadataRow } from "./types.ts";

export interface SessionSummaryData {
  /** Charging session ID — drives the View session URL. */
  id: string;
  /** Operator-friendly charger label, e.g. "Polaris HQ — Bay 2". */
  chargerName: string;
  /** ISO-formatted human-readable start. e.g. "Apr 22, 2026 at 14:32". */
  started: string;
  /** ISO-formatted human-readable end. */
  ended: string;
  /** Human-readable duration, e.g. "47 min". */
  duration: string;
  /** Energy delivered, formatted with units, e.g. "12.34 kWh". */
  energy: string;
  /** Cost — pre-formatted currency string. Omit (undefined) if not yet
   *  computed; the email then notes that cost will be available shortly. */
  cost?: string;
  /** Card label (last 4, friendly tag, etc.). */
  cardLabel: string;
}

export interface SessionSummaryInputs {
  to: string;
  session: SessionSummaryData;
}

/**
 * Build a preheader that always fits the 40–110 char window. We pad a short
 * charger name with the canonical billing prompt so very short labels don't
 * fail validation.
 */
function buildPreheader(chargerName: string): string {
  const base =
    `Your session at ${chargerName} finished — view full details and the cost breakdown below.`;
  if (base.length <= 110) return base;
  return base.slice(0, 109) + "…";
}

export function buildSessionSummaryEmail(
  inputs: SessionSummaryInputs,
): EmailTemplate {
  const { session } = inputs;
  const metadata: MetadataRow[] = [
    { label: "Charger", value: session.chargerName },
    { label: "Started", value: session.started },
    { label: "Ended", value: session.ended },
    { label: "Duration", value: session.duration },
    { label: "Energy", value: session.energy },
  ];
  if (session.cost) {
    metadata.push({ label: "Cost", value: session.cost, emphasis: true });
  }
  metadata.push({ label: "Card", value: session.cardLabel });

  const footerNote = session.cost
    ? "Your invoice will be available in your billing dashboard within 24 hours."
    : "Cost will be available shortly. Check your billing dashboard for the final total.";

  return {
    brand: "polaris",
    category: "session-summary",
    subject: "Charging session ended",
    preheader: buildPreheader(session.chargerName),
    title: "Charging session ended",
    body: [
      {
        type: "paragraph",
        text: `Your session at ${session.chargerName} is complete.`,
      },
    ],
    metadata,
    cta: {
      label: "View session",
      url: `https://polaris.express/sessions/${session.id}`,
      variant: "primary",
    },
    footerNote,
  };
}
