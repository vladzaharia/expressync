/**
 * Shared helper for the canonical charger display label.
 *
 * The chargeBoxId is an opaque OCPP identity string; operators set a friendlier
 * description in StEvE which mirrors into `chargers_cache.friendly_name`. UIs
 * should display the friendly name as the primary label and surface the
 * chargeBoxId as a small monospace disambiguator only when a friendly name is
 * actually present (otherwise the chargeBoxId itself is the label).
 */

export interface ChargerLabel {
  chargeBoxId: string;
  friendlyName: string | null | undefined;
}

/**
 * The primary display name. Falls back to chargeBoxId when no friendly name
 * is set (or when it's blank).
 */
export function chargerDisplayName(c: ChargerLabel): string {
  const trimmed = c.friendlyName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : c.chargeBoxId;
}

/**
 * True when we should render the chargeBoxId as a secondary chip next to the
 * friendly name. False when the chargeBoxId IS the displayed label.
 */
export function shouldShowChargeBoxIdChip(c: ChargerLabel): boolean {
  const trimmed = c.friendlyName?.trim();
  return !!trimmed && trimmed.length > 0 && trimmed !== c.chargeBoxId;
}
