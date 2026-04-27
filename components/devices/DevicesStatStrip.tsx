/**
 * DevicesStatStrip — unified devices listing stat strip.
 *
 * Five teal-accented cells covering the merged charger + scanner fleet. The
 * "Chargers" and "Scanners" cells double as filter shortcuts (clicking applies
 * `?type=charger` / `?type=scanner` on the same page) and render the
 * `aria-current="true"` ring when their type filter is active. The Offline
 * cell upgrades to amber when any device in the visible set is offline.
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
  scanners: number;
  chargers: number;
}

interface Props {
  totals: Totals;
  /** Active type filter, drives the `active` ring on Chargers/Scanners cells. */
  activeType?: "all" | "charger" | "scanner";
  class?: string;
}

export function DevicesStatStrip(
  { totals, activeType = "all", class: className }: Props,
) {
  const offlineWarning = totals.offline > 0;

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
      key: "chargers",
      label: "Chargers",
      value: totals.chargers,
      icon: BatteryCharging,
      href: "/admin/devices?type=charger",
      active: activeType === "charger",
      disabledWhenZero: totals.chargers === 0,
      title: "Filter to chargers",
    },
    {
      key: "scanners",
      label: "Scanners",
      value: totals.scanners,
      icon: Smartphone,
      href: "/admin/devices?type=scanner",
      active: activeType === "scanner",
      disabledWhenZero: totals.scanners === 0,
      title: "Filter to scanners (phones / laptops)",
    },
  ];

  return <StatStrip items={items} accent="teal" class={className} />;
}
