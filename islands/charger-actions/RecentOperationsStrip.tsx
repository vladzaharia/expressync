/**
 * RecentOperationsStrip — horizontal-scroll strip of the last ~5 operations
 * for this charger.
 *
 * Polls `GET /api/admin/charger/operation?chargeBoxId=...&limit=5` every 5s. Each
 * chip surfaces op name + status pill + relative timestamp; clicking a chip
 * opens a small detail popover (rendered inline with `<details>` for
 * simplicity). The `bump` prop is incremented by the parent whenever a new
 * op is submitted so we can force an immediate refetch without waiting for
 * the next tick.
 *
 * TODO(sse): subscribe to `operation.completed` via the existing SSE
 * transport (`islands/shared/SseProvider.tsx`) instead of polling every 5s.
 * This was deferred in Wave B4 because wiring the server-side publisher
 * plus event-bus union addition ballooned the PR scope. The polling
 * fallback below is deliberately kept light (5 rows × 5s = negligible).
 */

import { useEffect, useState } from "preact/hooks";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-preact";
import type { OcppOperationName } from "@/src/lib/types/steve.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface StripRow {
  id: number;
  operation: OcppOperationName | string;
  status: string;
  taskId: number | null;
  createdAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  requestedByEmail: string | null;
}

interface Props {
  chargeBoxId: string;
  /** Bumped by parent after every submitted op to force an immediate refetch. */
  bump: number;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.round(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function statusStyle(
  status: string,
): { Icon: typeof CheckCircle2; cls: string } {
  const s = status.toLowerCase();
  if (s === "success" || s === "completed") {
    return {
      Icon: CheckCircle2,
      cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/40",
    };
  }
  if (s === "failed" || s === "timeout") {
    return {
      Icon: XCircle,
      cls: "bg-rose-500/10 text-rose-600 border-rose-500/40",
    };
  }
  if (s === "dry_run") {
    return {
      Icon: Clock,
      cls: "bg-sky-500/10 text-sky-600 border-sky-500/40",
    };
  }
  return {
    Icon: Loader2,
    cls: "bg-amber-500/10 text-amber-600 border-amber-500/40",
  };
}

export default function RecentOperationsStrip({ chargeBoxId, bump }: Props) {
  const [rows, setRows] = useState<StripRow[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/admin/charger/operation?chargeBoxId=${
            encodeURIComponent(chargeBoxId)
          }&limit=5`,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        if (Array.isArray(json.rows)) setRows(json.rows as StripRow[]);
      } catch {
        // swallow
      }
    }

    load();
    const iv = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [chargeBoxId, bump]);

  if (rows.length === 0) return null;

  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs font-semibold text-muted-foreground">
        Recent operations
      </div>
      <div
        class="flex gap-2 overflow-x-auto pb-1"
        role="list"
        aria-label="Recent remote operations"
      >
        {rows.map((r) => {
          const { Icon, cls } = statusStyle(r.status);
          const spinning = r.status === "pending" || r.status === "submitted";
          const isExpanded = expandedId === r.id;
          return (
            <button
              key={r.id}
              role="listitem"
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : r.id)}
              class={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors hover:brightness-110",
                cls,
                isExpanded && "ring-2 ring-ring ring-offset-1",
              )}
            >
              <Icon
                class={cn("size-3.5", spinning && "animate-spin")}
                aria-hidden="true"
              />
              <span class="font-medium">{r.operation}</span>
              <span class="opacity-70">· {r.status}</span>
              <span class="opacity-60">· {relTime(r.createdAt)}</span>
            </button>
          );
        })}
      </div>
      {expandedId !== null && (() => {
        const r = rows.find((x) => x.id === expandedId);
        if (!r) return null;
        return (
          <div class="rounded-md border bg-muted/30 p-3 text-xs">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span>audit #{r.id}</span>
              {r.taskId !== null && <span>task {r.taskId}</span>}
              <span>started {relTime(r.createdAt)}</span>
              {r.completedAt && <span>completed {relTime(r.completedAt)}</span>}
              {r.requestedByEmail && <span>by {r.requestedByEmail}</span>}
            </div>
            {r.result && (
              <pre class="mt-2 max-h-48 overflow-auto rounded bg-background/50 p-2 font-mono text-[11px]">
                {JSON.stringify(r.result, null, 2)}
              </pre>
            )}
          </div>
        );
      })()}
    </div>
  );
}
