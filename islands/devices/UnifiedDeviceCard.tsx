/**
 * UnifiedDeviceCard — thin discriminated-union router that selects between
 * `ChargerCard` and `DeviceCard` based on the entry's `type`. Lives as an
 * island so the underlying ChargerCard can hydrate with its live-kW SSE
 * subscription on the listing page.
 *
 * Both child cards already share the same outer visual treatment (rounded-xl
 * border, status halo, capability pills, divider, action row) — this router
 * is the consolidation seam, not a re-skin.
 */

import ChargerCard, { type ChargerCardDto } from "@/islands/ChargerCard.tsx";
import DeviceCard, { type DeviceCardDto } from "@/islands/DeviceCard.tsx";

export type UnifiedDeviceEntry =
  | { type: "charger"; data: ChargerCardDto }
  | { type: "scanner"; data: DeviceCardDto };

export interface UnifiedDeviceCardProps {
  entry: UnifiedDeviceEntry;
  isAdmin?: boolean;
}

export default function UnifiedDeviceCard(
  { entry, isAdmin = false }: UnifiedDeviceCardProps,
) {
  if (entry.type === "charger") {
    return <ChargerCard charger={entry.data} isAdmin={isAdmin} />;
  }
  return <DeviceCard device={entry.data} isAdmin={isAdmin} />;
}
