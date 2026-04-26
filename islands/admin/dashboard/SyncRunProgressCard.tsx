/**
 * SyncRunProgressCard — segments grid for the latest sync_runs row.
 *
 * SSR seeds the in-flight run (if any) and the schedule state. Subscribes to
 * `sync.completed` SSE so the panel transitions out of "running" without a
 * page reload.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  CheckCircle2,
  CircleDashed,
  Clock,
  Layers,
  RefreshCw,
  XCircle,
} from "lucide-preact";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface InFlightSyncDTO {
  id: number;
  startedAt: string;
  tagLinkingStatus: string | null;
  transactionSyncStatus: string | null;
  transactionsProcessed: number | null;
  eventsCreated: number | null;
}

export interface ScheduleDTO {
  currentTier: "active" | "idle" | "dormant";
  nextRunAt: string | null;
  lastActivityAt: string | null;
  pinnedTier: string | null;
  pinnedUntil: string | null;
}

interface Props {
  inFlight: InFlightSyncDTO | null;
  schedule: ScheduleDTO;
}

function segmentTone(status: string | null) {
  if (status === "success") {
    return {
      icon: CheckCircle2,
      class: "text-emerald-600 dark:text-emerald-400",
      label: "Success",
    };
  }
  if (status === "warning") {
    return {
      icon: CircleDashed,
      class: "text-amber-600 dark:text-amber-400",
      label: "Warning",
    };
  }
  if (status === "error") {
    return {
      icon: XCircle,
      class: "text-rose-600 dark:text-rose-400",
      label: "Error",
    };
  }
  if (status === "skipped") {
    return {
      icon: CircleDashed,
      class: "text-muted-foreground",
      label: "Skipped",
    };
  }
  return {
    icon: RefreshCw,
    class: "text-blue-600 dark:text-blue-400 animate-spin",
    label: "Running",
  };
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const delta = t - Date.now();
  const abs = Math.abs(delta);
  const m = Math.round(abs / 60_000);
  if (m < 1) return delta >= 0 ? "in <1m" : "moments ago";
  if (m < 60) return delta >= 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  return delta >= 0 ? `in ${h}h` : `${h}h ago`;
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${r}s`;
}

export default function SyncRunProgressCard(
  { inFlight: initialInFlight, schedule }: Props,
) {
  const inFlight = useSignal<InFlightSyncDTO | null>(initialInFlight);
  const _tick = useSignal(0);

  useEffect(() => {
    const unsub = subscribeSse("sync.completed", () => {
      // The just-completed sync may have been the one we were tracking.
      // Drop the in-flight pointer; the parent's polling will pick up the
      // next run if one starts.
      inFlight.value = null;
    });
    const tick = setInterval(() => {
      _tick.value = Date.now();
    }, 1_000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  if (!inFlight.value) {
    return (
      <div class="flex flex-col gap-3 text-sm">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Layers class="size-4" />
          No sync currently running.
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-md border bg-muted/30 px-3 py-2">
            <p class="text-muted-foreground">Tier</p>
            <p class="mt-0.5 font-medium capitalize">
              {schedule.currentTier}
              {schedule.pinnedTier && (
                <span class="ml-1 text-amber-600 dark:text-amber-400">
                  (pinned)
                </span>
              )}
            </p>
          </div>
          <div class="rounded-md border bg-muted/30 px-3 py-2">
            <p class="text-muted-foreground inline-flex items-center gap-1">
              <Clock class="size-3" /> Next run
            </p>
            <p
              class="mt-0.5 font-medium"
              title={schedule.nextRunAt
                ? new Date(schedule.nextRunAt).toLocaleString()
                : undefined}
            >
              {relTime(schedule.nextRunAt)}
            </p>
          </div>
        </div>
        <a
          href="/sync"
          class="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          View sync history →
        </a>
      </div>
    );
  }

  const segments = [
    {
      key: "tag_linking",
      label: "Tag linking",
      status: inFlight.value.tagLinkingStatus,
    },
    {
      key: "transaction_sync",
      label: "Transaction sync",
      status: inFlight.value.transactionSyncStatus,
    },
  ];

  return (
    <div class="flex flex-col gap-3 text-sm">
      <div class="flex items-center justify-between">
        <a
          href={`/sync/${inFlight.value.id}`}
          class="font-medium text-blue-700 dark:text-blue-300 hover:underline"
        >
          Sync #{inFlight.value.id}
        </a>
        <span class="text-xs text-muted-foreground tabular-nums">
          {elapsed(inFlight.value.startedAt)}
        </span>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {segments.map((seg) => {
          const t = segmentTone(seg.status);
          const Icon = t.icon;
          return (
            <div
              key={seg.key}
              class="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2"
            >
              <span class="text-sm">{seg.label}</span>
              <span class="inline-flex items-center gap-1.5 text-xs">
                <Icon class={cn("size-3.5", t.class)} />
                <span class="text-muted-foreground">{t.label}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div class="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {inFlight.value.transactionsProcessed ?? 0} transactions ·{" "}
          {inFlight.value.eventsCreated ?? 0} events
        </span>
      </div>
    </div>
  );
}
