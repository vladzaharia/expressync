/**
 * DevicesStatStrip — devices listing stat strip.
 *
 * Five teal-accented cells. The Offline cell upgrades to an amber warning
 * tone when any devices are offline (mirroring `ChargersStatStrip`'s pattern).
 * Phones cell goes muted when zero (admin's first-run state — no phones yet).
 * Chargers cell is informational and links across to `/admin/chargers` so the
 * sidebar entry isn't the only path between the two surfaces.
 *
 * Thin wrapper over the shared `StatStrip` primitive.
 */

import {
  AlertTriangle,
  BatteryCharging,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-preact";
import {
  StatStrip,
  type StatStripItem,
} from "@/components/shared/StatStrip.tsx";

interface Totals {
  total: number;
  online: number;
  offline: number;
  phones: number;
  chargers: number;
}

interface Props {
  totals: Totals;
  class?: string;
}

export function DevicesStatStrip({ totals, class: className }: Props) {
  const offlineWarning = totals.offline > 0;
  const phonesZero = totals.phones === 0;

  const items: StatStripItem[] = [
    {
      key: "total",
      label: "Total",
      value: totals.total,
      icon: Smartphone,
    },
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
      key: "phones",
      label: "Phones",
      value: totals.phones,
      icon: Smartphone,
      tone: "muted",
      disabledWhenZero: phonesZero,
    },
    {
      key: "chargers",
      label: "Chargers",
      value: totals.chargers,
      icon: BatteryCharging,
      tone: "muted",
      href: "/admin/chargers",
      title: "View chargers — managed on the Chargers page",
    },
  ];

  return <StatStrip items={items} accent="teal" class={className} />;
}
