/**
 * SyncSegmentTabs — tabbed segment browser for `/sync/[id]`.
 *
 * Replaces the old single-column accordion with a three-tab layout ("Tag
 * Linking", "Charging Sessions Sync", "Scheduling"). Each tab supports:
 *   - a compact header row (log-line count + segment duration)
 *   - a per-tag search input (only rendered on the Tag Linking and Charging
 *     Sessions Sync tabs) that filters logs client-side by message substring
 *     match, including on the serialized `context` JSON so tag values buried
 *     in context are discoverable
 *   - a severity toggle (All / Errors only)
 *   - the same log-row rendering that the old accordion used
 *
 * If `runIsRunning` is true, this island subscribes to `sync.completed` via
 * the shared `SseProvider` and reloads the page when its `syncRunId` matches.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  Link2,
  MinusCircle,
  Package,
  Receipt,
  RefreshCcw,
  Search,
  Shuffle,
  Users,
  Wallet,
} from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { SyncRun, SyncRunLog } from "@/src/db/schema.ts";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import type { SyncCompletedPayload } from "@/src/services/event-bus.service.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  run: SyncRun;
  tagLinkingLogs: SyncRunLog[];
  transactionSyncLogs: SyncRunLog[];
  schedulingLogs: SyncRunLog[];
  lagoCustomersLogs: SyncRunLog[];
  lagoSubscriptionsLogs: SyncRunLog[];
  lagoPlansLogs: SyncRunLog[];
  lagoInvoicesLogs: SyncRunLog[];
  lagoWalletsLogs: SyncRunLog[];
  lagoBillableMetricsLogs: SyncRunLog[];
  localReconcileLogs: SyncRunLog[];
  runIsRunning: boolean;
}

type TabKey =
  | "tag_linking"
  | "transaction_sync"
  | "scheduling"
  | "lago_customers"
  | "lago_subscriptions"
  | "lago_plans"
  | "lago_invoices"
  | "lago_wallets"
  | "lago_billable_metrics"
  | "local_reconcile";

/** Derive segment status from logs (no dedicated sync_runs column). */
function deriveStatus(logs: SyncRunLog[]): string | null {
  if (logs.length === 0) return null;
  if (logs.some((l) => l.level === "error")) return "error";
  if (logs.some((l) => l.level === "warn")) return "warning";
  return "success";
}

function SegmentStatusBadge({
  status,
  runCompleted,
}: {
  status: string | null;
  runCompleted: boolean;
}) {
  if (!status) {
    const label = runCompleted ? "Unknown" : "Pending";
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <MinusCircle className="size-3 mr-1" />
        {label}
      </Badge>
    );
  }
  const variants: Record<
    string,
    {
      variant: "success" | "warning" | "destructive" | "secondary" | "outline";
      icon: typeof CheckCircle2;
    }
  > = {
    success: { variant: "success", icon: CheckCircle2 },
    warning: { variant: "warning", icon: AlertTriangle },
    error: { variant: "destructive", icon: AlertCircle },
    skipped: { variant: "secondary", icon: MinusCircle },
  };
  const config = variants[status] ||
    { variant: "outline" as const, icon: Info };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="size-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function LogLevelIcon({ level }: { level: string }) {
  switch (level) {
    case "error":
      return <AlertCircle className="size-4 text-destructive" />;
    case "warn":
      return <AlertTriangle className="size-4 text-yellow-500" />;
    case "info":
      return <Info className="size-4 text-blue-500" />;
    default:
      return <Info className="size-4 text-muted-foreground" />;
  }
}

function segmentDuration(logs: SyncRunLog[]): string {
  if (logs.length < 2) return "-";
  const sorted = [...logs].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const ms = new Date(sorted[sorted.length - 1].createdAt).getTime() -
    new Date(sorted[0].createdAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export default function SyncSegmentTabs(
  {
    run,
    tagLinkingLogs,
    transactionSyncLogs,
    schedulingLogs,
    lagoCustomersLogs,
    lagoSubscriptionsLogs,
    lagoPlansLogs,
    lagoInvoicesLogs,
    lagoWalletsLogs,
    lagoBillableMetricsLogs,
    localReconcileLogs,
    runIsRunning,
  }: Props,
) {
  const active = useSignal<TabKey>("tag_linking");
  const search = useSignal("");
  const errorsOnly = useSignal(false);

  useEffect(() => {
    if (!runIsRunning) return;
    const unsub = subscribeSse("sync.completed", (payload: unknown) => {
      const p = payload as SyncCompletedPayload | null;
      if (p && p.syncRunId === run.id) {
        globalThis.location.reload();
      }
    });
    return unsub;
  }, [runIsRunning, run.id]);

  const isCompleted = run.status === "completed" || run.status === "failed";
  const schedulingStatus = schedulingLogs.length === 0
    ? null
    : schedulingLogs.some((l) => l.level === "error")
    ? "error"
    : schedulingLogs.some((l) => l.level === "warn")
    ? "warning"
    : "success";

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: typeof Link2;
    status: string | null;
    logs: SyncRunLog[];
    searchable: boolean;
  }> = [
    {
      key: "tag_linking",
      label: "Tag Linking",
      icon: Link2,
      status: run.tagLinkingStatus,
      logs: tagLinkingLogs,
      searchable: true,
    },
    {
      key: "transaction_sync",
      label: "Charging Sessions Sync",
      icon: Receipt,
      status: run.transactionSyncStatus,
      logs: transactionSyncLogs,
      searchable: true,
    },
    {
      key: "scheduling",
      label: "Scheduling",
      icon: Clock,
      status: schedulingStatus,
      logs: schedulingLogs,
      searchable: false,
    },
    {
      key: "lago_customers",
      label: "Customers",
      icon: Users,
      status: deriveStatus(lagoCustomersLogs),
      logs: lagoCustomersLogs,
      searchable: true,
    },
    {
      key: "lago_subscriptions",
      label: "Subscriptions",
      icon: RefreshCcw,
      status: deriveStatus(lagoSubscriptionsLogs),
      logs: lagoSubscriptionsLogs,
      searchable: true,
    },
    {
      key: "lago_plans",
      label: "Plans",
      icon: Package,
      status: deriveStatus(lagoPlansLogs),
      logs: lagoPlansLogs,
      searchable: true,
    },
    {
      key: "lago_invoices",
      label: "Invoices",
      icon: Receipt,
      status: deriveStatus(lagoInvoicesLogs),
      logs: lagoInvoicesLogs,
      searchable: true,
    },
    {
      key: "lago_wallets",
      label: "Wallets",
      icon: Wallet,
      status: deriveStatus(lagoWalletsLogs),
      logs: lagoWalletsLogs,
      searchable: true,
    },
    {
      key: "lago_billable_metrics",
      label: "Metrics",
      icon: Gauge,
      status: deriveStatus(lagoBillableMetricsLogs),
      logs: lagoBillableMetricsLogs,
      searchable: true,
    },
    {
      key: "local_reconcile",
      label: "Local Reconcile",
      icon: Shuffle,
      status: deriveStatus(localReconcileLogs),
      logs: localReconcileLogs,
      searchable: true,
    },
  ];

  const activeTab = useComputed(() =>
    tabs.find((t) => t.key === active.value) ?? tabs[0]
  );

  const filteredLogs = useComputed(() => {
    const tab = activeTab.value;
    const q = search.value.trim().toLowerCase();
    return tab.logs.filter((l) => {
      if (errorsOnly.value && l.level !== "error") return false;
      if (q && tab.searchable) {
        const hay = `${l.message} ${l.context ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  return (
    <div class="space-y-4">
      {/* Tablist */}
      <div
        role="tablist"
        aria-label="Sync segments"
        class="flex flex-wrap gap-1 border-b"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active.value === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                active.value = tab.key;
                search.value = "";
              }}
              class={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <Icon class="size-4" />
              <span>{tab.label}</span>
              <SegmentStatusBadge
                status={tab.status}
                runCompleted={isCompleted}
              />
            </button>
          );
        })}
      </div>

      {/* Controls + header row */}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">
            {filteredLogs.value.length}
          </span>{" "}
          of {activeTab.value.logs.length} log
          {activeTab.value.logs.length !== 1 ? "s" : ""}
          <span class="mx-2">·</span>
          duration {segmentDuration(activeTab.value.logs)}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {activeTab.value.searchable && (
            <div class="relative">
              <Search
                class="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder="Search logs / tag…"
                value={search.value}
                onInput={(e) => {
                  search.value = (e.currentTarget as HTMLInputElement).value;
                }}
                class="pl-8 h-8 w-56"
              />
            </div>
          )}
          <div
            role="radiogroup"
            aria-label="Severity filter"
            class="flex items-center rounded-md border text-xs"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!errorsOnly.value}
              onClick={() => {
                errorsOnly.value = false;
              }}
              class={cn(
                "px-2.5 py-1 rounded-l-md transition-colors",
                !errorsOnly.value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              All
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={errorsOnly.value}
              onClick={() => {
                errorsOnly.value = true;
              }}
              class={cn(
                "px-2.5 py-1 rounded-r-md transition-colors border-l",
                errorsOnly.value
                  ? "bg-destructive/15 text-destructive"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              Errors only
            </button>
          </div>
        </div>
      </div>

      {/* Log list */}
      <div
        role="tabpanel"
        class="max-h-[32rem] overflow-y-auto rounded-md border bg-muted/10"
      >
        {filteredLogs.value.length === 0
          ? (
            <p class="text-sm text-muted-foreground py-8 text-center">
              {activeTab.value.logs.length === 0
                ? "No logs recorded for this segment."
                : "No logs match the current filters."}
            </p>
          )
          : (
            <div class="space-y-1 p-2">
              {filteredLogs.value.map((log) => (
                <div
                  key={log.id}
                  class="flex items-start gap-3 p-2 rounded-md bg-background text-sm border"
                >
                  <LogLevelIcon level={log.level} />
                  <div class="flex-1 min-w-0">
                    <p class="break-words">{log.message}</p>
                    {log.context && (
                      <pre class="mt-1 text-xs text-muted-foreground overflow-x-auto">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(log.context), null, 2);
                        } catch {
                          return log.context;
                        }
                      })()}
                      </pre>
                    )}
                  </div>
                  <span class="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
