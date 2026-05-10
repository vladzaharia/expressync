/**
 * Connector type catalogue — single source of truth for the wire enum
 * pinned by the `charger_connectors_connector_type_check` CHECK
 * constraint.
 *
 * Every dropdown / API validator / DB check constraint that touches
 * connector type values agrees on these five strings. The UI labels
 * are the user-facing display values and ride alongside.
 */

export const CONNECTOR_TYPES = [
  "ccs",
  "j1772",
  "nacs",
  "chademo",
  "type2",
] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export function isConnectorType(value: unknown): value is ConnectorType {
  return typeof value === "string" &&
    (CONNECTOR_TYPES as readonly string[]).includes(value);
}

/** Human-readable labels for the connector-type dropdown. */
export const CONNECTOR_TYPE_LABELS: Record<ConnectorType, string> = {
  j1772: "J1772 (Type 1, AC)",
  type2: "Type 2 / Mennekes (AC)",
  nacs: "NACS / J3400 (Tesla)",
  ccs: "CCS Combo",
  chademo: "CHAdeMO",
};

/** Preset kW values for the `max_kw` dropdown. Spans Level 1 trickle
 *  through ultra-fast DC. Stored as numbers; numeric(6,2) round-trips
 *  cleanly. */
export const KW_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  // Level 1 — 120 V
  { value: 1.4, label: "1.4 kW (Level 1, 120 V)" },
  { value: 1.9, label: "1.9 kW (Level 1, 120 V @ 16 A)" },
  // Level 2 — 240 V
  { value: 3.7, label: "3.7 kW (Level 2, 16 A)" },
  { value: 7.2, label: "7.2 kW (Level 2, 30 A)" },
  { value: 7.7, label: "7.7 kW (Level 2, 32 A)" },
  { value: 9.6, label: "9.6 kW (Level 2, 40 A)" },
  { value: 11.5, label: "11.5 kW (Level 2, 48 A)" },
  { value: 19.2, label: "19.2 kW (Level 2, 80 A)" },
  // DC fast
  { value: 24, label: "24 kW (DC fast, low)" },
  { value: 50, label: "50 kW (DC fast, CCS/CHAdeMO)" },
  { value: 62.5, label: "62.5 kW (CHAdeMO 1.x)" },
  { value: 75, label: "75 kW" },
  { value: 100, label: "100 kW" },
  { value: 150, label: "150 kW (DC fast, mid-tier)" },
  { value: 175, label: "175 kW (EA-tier)" },
  { value: 200, label: "200 kW" },
  { value: 250, label: "250 kW (Tesla V3)" },
  { value: 350, label: "350 kW (ultra-fast)" },
];
