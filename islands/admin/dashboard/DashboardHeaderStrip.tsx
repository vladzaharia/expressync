/**
 * DashboardHeaderStrip — slim "system pulse" row at the top of the admin
 * dashboard. SSR seeds the values; SSE updates the in-flight sync indicator
 * and charger-online dot live.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  AlertCircle,
  Bell,
  CircleDashed,
  Clock,
  Plug,
  RefreshCw,
} from "lucide-preact";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface PulseProps {
  syncTier: "active" | "idle" | "dormant";
  nextRunAt: string | null;
  inFlightSyncRunId: number | null;
  chargersOnline: number;
  chargersTotal: number;
  unreadAlerts: number;
}

function tierTone(tier: "active" | "idle" | "dormant") {
  switch (tier) {
    case "active":
      return "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10";
    case "idle":
      return "text-cyan-700 dark:text-cyan-300 bg-cyan-500/10";
    case "dormant":
      return "text-slate-600 dark:text-slate-300 bg-slate-500/10";
  }
}

function fleetTone(online: number, total: number) {
  if (total === 0) return "bg-slate-400/40";
  const ratio = online / total;
  if (ratio >= 0.95) return "bg-emerald-500";
  if (ratio >= 0.7) return "bg-amber-500";
  return "bg-rose-500";
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const delta = t - Date.now();
  const abs = Math.abs(delta);
  const m = Math.round(abs / 60_000);
  if (m < 1) return delta >= 0 ? "in <1m" : "just now";
  if (m < 60) return delta >= 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  return delta >= 0 ? `in ${h}h` : `${h}h ago`;
}

export default function DashboardHeaderStrip(props: PulseProps) {
  const inFlightId = useSignal<number | null>(props.inFlightSyncRunId);
  const online = useSignal<number>(props.chargersOnline);
  const total = useSignal<number>(props.chargersTotal);
  const _tick = useSignal(0);

  useEffect(() => {
    const unsubSync = subscribeSse("sync.completed", () => {
      // A sync just finished — clear the in-flight indicator. A fresh
      // overview poll (driven by the parent) will pick up the next one.
      inFlightId.value = null;
    });
    const unsubCharger = subscribeSse("charger.state", (raw) => {
      // We don't get a full fleet rollup over SSE; just nudge the tick so
      // the parent's interval re-fetch is the source of truth. We *do*
      // optimistically bump the dot's saturation if we see lots of
      // events.
      const p = raw as { online?: boolean };
      if (typeof p.online === "boolean") {
        online.value = Math.max(0, online.value + (p.online ? 1 : -1));
      }
      _tick.value = Date.now();
    });
    const tick = setInterval(() => {
      _tick.value = Date.now();
    }, 30_000);
    return () => {
      unsubSync();
      unsubCharger();
      clearInterval(tick);
    };
  }, []);

  return (
    <div class="flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 px-3 py-2 text-sm">
      {/* Sync tier */}
      <span
        class={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
          tierTone(props.syncTier),
        )}
        title={`Sync scheduler tier: ${props.syncTier}`}
      >
        <CircleDashed class="size-3.5" />
        {props.syncTier === "active"
          ? "Active sync"
          : props.syncTier === "idle"
          ? "Idle"
          : "Dormant"}
      </span>

      {/* In-flight sync */}
      {inFlightId.value !== null
        ? (
          <a
            href={`/sync/${inFlightId.value}`}
            class="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
          >
            <RefreshCw class="size-3.5 animate-spin" />
            Sync #{inFlightId.value} running
          </a>
        )
        : props.nextRunAt
        ? (
          <span
            class="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            title={`Next run scheduled at ${
              new Date(props.nextRunAt).toLocaleString()
            }`}
          >
            <Clock class="size-3.5" />
            Next run {relTime(props.nextRunAt)}
          </span>
        )
        : null}

      <span class="mx-1 hidden h-4 w-px bg-border sm:inline-block" />

      {/* Fleet pulse */}
      <a
        href="/chargers"
        class="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted"
        title="Chargers online (last status within 10 min)"
      >
        <span
          class={cn(
            "size-2 rounded-full",
            fleetTone(online.value, total.value),
          )}
          aria-hidden="true"
        />
        <Plug class="size-3.5 text-muted-foreground" />
        <span class="tabular-nums">
          {online.value}
          <span class="text-muted-foreground">/{total.value}</span>{" "}
          chargers online
        </span>
      </a>

      {/* Unread alerts */}
      {props.unreadAlerts > 0
        ? (
          <a
            href="/notifications"
            class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
          >
            <Bell class="size-3.5" />
            {props.unreadAlerts} unread
          </a>
        )
        : (
          <span class="ml-auto inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
            <AlertCircle class="size-3.5" />
            All clear
          </span>
        )}
    </div>
  );
}
