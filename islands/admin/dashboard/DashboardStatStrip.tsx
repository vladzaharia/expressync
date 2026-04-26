/**
 * DashboardStatStrip — six interactive cells at the top of the admin
 * dashboard. SSR seeds every value; the active-sessions count updates live
 * from `transaction.meter` SSE so it stays current between overview polls.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Calendar, CheckCircle2, Plug, PlugZap, Zap } from "lucide-preact";
import {
  StatStrip,
  type StatStripItem,
} from "@/components/shared/StatStrip.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";

interface Props {
  kwhToday: number;
  activeSessions: number;
  chargersOnline: number;
  chargersOffline: number;
  pendingReservations: number;
  syncSuccess7d: number;
}

const TTL_MS = 90_000;

export default function DashboardStatStrip(props: Props) {
  // Only the live-updating tile gets a signal; the rest are SSR-frozen until
  // the parent polls the overview endpoint and re-renders.
  const liveActive = useSignal<number>(props.activeSessions);

  useEffect(() => {
    // Maintain a Map<txId, lastSeenMs> exactly the way ActiveSessionsCard
    // does so the tile shows the same number that section card shows.
    const seen = new Map<string, number>();
    // Seed with the SSR-known count so we don't drop to 0 until the first
    // SSE event arrives.
    let baseline = props.activeSessions;

    const recompute = () => {
      const cutoff = Date.now() - TTL_MS;
      let live = 0;
      for (const [k, v] of seen) {
        if (v < cutoff) seen.delete(k);
        else live += 1;
      }
      // Once we've started seeing live events, stop trusting the SSR baseline.
      if (live > 0) baseline = 0;
      liveActive.value = Math.max(live, baseline);
    };

    const unsub = subscribeSse("transaction.meter", (raw) => {
      const p = raw as { transactionId: number | string; endedAt?: string };
      const id = String(p.transactionId);
      if (p.endedAt) seen.delete(id);
      else seen.set(id, Date.now());
      recompute();
    });
    const sweep = setInterval(recompute, 5_000);
    return () => {
      unsub();
      clearInterval(sweep);
    };
  }, []);

  const items: StatStripItem[] = [
    {
      key: "kwh-today",
      label: "kWh today",
      value: props.kwhToday.toFixed(1),
      icon: Zap,
      href: "/transactions",
      tone: "emerald",
    },
    {
      key: "active",
      label: "Active sessions",
      value: liveActive.value,
      icon: PlugZap,
      href: "/transactions",
      tone: "emerald",
    },
    {
      key: "chargers-online",
      label: "Chargers online",
      value: props.chargersOnline,
      icon: Plug,
      href: "/chargers",
      tone: props.chargersOffline > 0 ? "amber" : "cyan",
      title: props.chargersOffline > 0
        ? `${props.chargersOffline} chargers offline`
        : undefined,
    },
    {
      key: "reservations",
      label: "Pending reservations",
      value: props.pendingReservations,
      icon: Calendar,
      href: "/reservations",
      tone: "violet",
      disabledWhenZero: true,
    },
    {
      key: "sync-rate",
      label: "Sync success 7d",
      value: `${props.syncSuccess7d}%`,
      icon: CheckCircle2,
      href: "/sync",
      tone: props.syncSuccess7d < 80
        ? "rose"
        : props.syncSuccess7d < 95
        ? "amber"
        : "cyan",
    },
  ];

  return <StatStrip items={items} accent="cyan" />;
}
