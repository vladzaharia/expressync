/**
 * ChargersStatStrip — chargers listing stat strip.
 *
 * Four orange-accented cells. The Offline cell upgrades to an amber
 * warning tone when any chargers are offline. Thin wrapper over the shared
 * `StatStrip` primitive.
 */

import { AlertTriangle, Gauge, Wifi, WifiOff, Zap } from "lucide-preact";
import {
  StatStrip,
  type StatStripItem,
} from "@/components/shared/StatStrip.tsx";

interface Totals {
  online: number;
  offline: number;
  chargingNow: number;
  kwhLast24h: number;
}

interface Props {
  totals: Totals;
  class?: string;
}

export function ChargersStatStrip({ totals, class: className }: Props) {
  const offlineWarning = totals.offline > 0;
  const kwhDisplay = `${totals.kwhLast24h.toFixed(1)} kWh`;

  const items: StatStripItem[] = [
    {
      key: "online",
      label: "Online",
      value: totals.online,
      icon: Wifi,
    },
    {
      key: "offline",
      label: "Offline",
      value: totals.offline,
      icon: offlineWarning ? AlertTriangle : WifiOff,
      tone: offlineWarning ? "amber" : "muted",
    },
    {
      key: "charging",
      label: "Charging now",
      value: totals.chargingNow,
      icon: Zap,
    },
    {
      key: "kwh",
      label: "kWh (24h)",
      value: kwhDisplay,
      icon: Gauge,
    },
  ];

  return <StatStrip items={items} accent="orange" class={className} />;
}
