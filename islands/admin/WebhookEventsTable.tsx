import { useEffect } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { toast } from "sonner";
import {
  AlertCircle,
  Bell,
  Calendar,
  CheckCircle2,
  CircleDot,
  Loader2,
  RefreshCcw,
  RotateCcw,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { WebhookTypeBadge } from "@/components/admin/WebhookTypeBadge.tsx";
import {
  deriveWebhookStatus,
  WebhookStatusBadge,
} from "@/components/admin/WebhookStatusBadge.tsx";
import { PayloadViewer } from "@/components/admin/PayloadViewer.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface WebhookEventRow {
  id: number;
  webhookType: string;
  objectType: string | null;
  lagoObjectId: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  receivedAt: string;
  processedAt: string | null;
  processingError: string | null;
  notificationFired: boolean;
  replayedFromId: number | null;
  replayedAt: string | null;
  replayedByUserId: string | null;
}

interface Props {
  initialItems: WebhookEventRow[];
  initialTotal: number;
  initialQuery: string; // serialized filter query string ("" or "status=failed&...")
  pageSize?: number;
  currentUserRole?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function WebhookEventsTable({
  initialItems,
  initialTotal,
  initialQuery,
  pageSize = 25,
  currentUserRole,
}: Props) {
  const items = useSignal<WebhookEventRow[]>(initialItems);
  const total = useSignal<number>(initialTotal);
  const loading = useSignal(false);
  const expandedId = useSignal<number | null>(null);
  const payloadCache = useSignal<Record<number, unknown>>({});
  const selected = useSignal<Set<number>>(new Set());

  const confirmReplayId = useSignal<number | null>(null);
  const confirmBulkReplay = useSignal(false);
  const replayInFlight = useSignal<Set<number>>(new Set());

  const isAdmin = currentUserRole === "admin";

  const canLoadMore = useComputed(() => items.value.length < total.value);

  // Keep the URL query in sync for shareability.
  useEffect(() => {
    // No-op on first mount — the server already rendered with the query.
  }, []);

  async function refetch(newQuery?: string) {
    loading.value = true;
    try {
      const qs = new URLSearchParams(newQuery ?? initialQuery);
      qs.set("skip", "0");
      qs.set("limit", String(pageSize));
      const res = await fetch(`/api/admin/webhook-events?${qs.toString()}`);
      if (!res.ok) {
        toast.error(`Refresh failed (${res.status})`);
        return;
      }
      const data = await res.json() as {
        items: WebhookEventRow[];
        total: number;
      };
      items.value = data.items;
      total.value = data.total;
    } catch (err) {
      toast.error(
        `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    if (loading.value || !canLoadMore.value) return;
    loading.value = true;
    try {
      const qs = new URLSearchParams(initialQuery);
      qs.set("skip", String(items.value.length));
      qs.set("limit", String(pageSize));
      const res = await fetch(`/api/admin/webhook-events?${qs.toString()}`);
      if (!res.ok) {
        toast.error(`Load more failed (${res.status})`);
        return;
      }
      const data = await res.json() as { items: WebhookEventRow[] };
      items.value = [...items.value, ...data.items];
    } catch (err) {
      toast.error(
        `Load more failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      loading.value = false;
    }
  }

  async function toggleExpanded(id: number) {
    if (expandedId.value === id) {
      expandedId.value = null;
      return;
    }
    expandedId.value = id;
    // Lazy-load the full payload (the list endpoint returns row metadata only).
    if (!(id in payloadCache.value)) {
      try {
        const res = await fetch(`/api/admin/webhook-events/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const full = await res.json() as { rawPayload?: unknown };
        payloadCache.value = {
          ...payloadCache.value,
          [id]: full.rawPayload ?? {},
        };
      } catch (err) {
        toast.error(
          `Failed to load payload: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async function handleReplay(id: number) {
    if (replayInFlight.value.has(id)) return;
    replayInFlight.value = new Set([...replayInFlight.value, id]);
    try {
      const res = await fetch(`/api/admin/webhook-events/${id}/replay`, {
        method: "POST",
      });
      const body = await res.json() as {
        success: boolean;
        newEventId: number;
        error?: string;
      };
      if (body.success) {
        toast.success(`Replayed → new event #${body.newEventId}`);
        await refetch();
      } else {
        toast.error(
          `Replay failed: ${body.error ?? `HTTP ${res.status}`}`,
        );
      }
    } catch (err) {
      toast.error(
        `Replay failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      const next = new Set(replayInFlight.value);
      next.delete(id);
      replayInFlight.value = next;
      confirmReplayId.value = null;
    }
  }

  async function handleBulkReplay() {
    const ids = [...selected.value];
    if (ids.length === 0) {
      toast.error("No rows selected");
      return;
    }
    loading.value = true;
    try {
      const res = await fetch(`/api/admin/webhook-events/bulk-replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = await res.json() as {
        total: number;
        replayed: number;
        failed: number;
      };
      if (body.failed === 0) {
        toast.success(`${body.replayed} replayed`);
      } else {
        toast.error(`${body.replayed} replayed, ${body.failed} failed`);
      }
      selected.value = new Set();
      confirmBulkReplay.value = false;
      await refetch();
    } catch (err) {
      toast.error(
        `Bulk replay failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      loading.value = false;
    }
  }

  function toggleSelect(id: number, checked: boolean) {
    const next = new Set(selected.value);
    if (checked) next.add(id);
    else next.delete(id);
    selected.value = next;
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      selected.value = new Set(items.value.map((r) => r.id));
    } else {
      selected.value = new Set();
    }
  }

  const allVisibleSelected = useComputed(() =>
    items.value.length > 0 &&
    items.value.every((r) => selected.value.has(r.id))
  );

  if (items.value.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            No webhook events match the current filters.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={loading.value}
            className="gap-2"
          >
            <RefreshCcw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bulk actions bar */}
      {isAdmin && selected.value.size > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex items-center justify-between gap-2 rounded-md border border-slate-500/30 bg-slate-500/10 px-3 py-2"
        >
          <span className="text-sm">
            {selected.value.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                selected.value = new Set();
              }}
            >
              Clear selection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                confirmBulkReplay.value = true;
              }}
              disabled={loading.value}
              className="gap-1.5"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Replay selected
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          Showing {items.value.length} of {total.value} events
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={loading.value}
          className="gap-2"
        >
          {loading.value
            ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            : <RefreshCcw className="size-4" aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {isAdmin && (
                <th className="w-10 px-3 py-2 text-left">
                  <Checkbox
                    aria-label="Select all visible rows"
                    checked={allVisibleSelected.value}
                    onCheckedChange={(checked) =>
                      toggleSelectAll(checked === true)}
                  />
                </th>
              )}
              <th className="px-3 py-2 text-left">Received</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Subscription</th>
              <th className="px-3 py-2 text-left">Flags</th>
              <th className="w-24 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.value.map((row) => {
              const status = deriveWebhookStatus(row);
              const isExpanded = expandedId.value === row.id;
              const isSelected = selected.value.has(row.id);
              const isReplaying = replayInFlight.value.has(row.id);
              return (
                <>
                  <tr
                    key={row.id}
                    className={cn(
                      "border-t cursor-pointer hover:bg-muted/30 transition-colors",
                      isExpanded && "bg-muted/40",
                    )}
                    onClick={() => toggleExpanded(row.id)}
                  >
                    {isAdmin && (
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          aria-label={`Select row ${row.id}`}
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            toggleSelect(row.id, checked === true)}
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="size-3.5" aria-hidden="true" />
                        <span className="text-xs">
                          {formatDate(row.receivedAt)}
                        </span>
                      </div>
                      <div className="font-mono text-[0.65rem] opacity-60">
                        #{row.id}
                        {row.replayedFromId !== null && (
                          <span className="ml-1 text-slate-500">
                            ← #{row.replayedFromId}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <WebhookTypeBadge webhookType={row.webhookType} />
                    </td>
                    <td className="px-3 py-2">
                      <WebhookStatusBadge status={status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.externalCustomerId ?? (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.externalSubscriptionId ?? (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {row.notificationFired && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-sky-500/40 text-sky-700 dark:text-sky-300"
                            title="Triggered an admin notification"
                          >
                            <Bell className="size-3" aria-hidden="true" />
                            Notified
                          </Badge>
                        )}
                        {row.replayedFromId !== null && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-slate-500/40 text-slate-600 dark:text-slate-400"
                            title={`Replay of event #${row.replayedFromId}`}
                          >
                            <RotateCcw className="size-3" aria-hidden="true" />
                            Replay
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            confirmReplayId.value = row.id;
                          }}
                          disabled={isReplaying}
                          className="gap-1"
                        >
                          {isReplaying
                            ? (
                              <Loader2
                                className="size-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            )
                            : (
                              <RotateCcw
                                className="size-3.5"
                                aria-hidden="true"
                              />
                            )}
                          Replay
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t bg-muted/20">
                      <td
                        className="px-3 py-3"
                        colSpan={isAdmin ? 8 : 7}
                      >
                        <div className="space-y-3">
                          {row.processingError && (
                            <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm">
                              <AlertCircle
                                className="mt-0.5 size-4 shrink-0 text-rose-500"
                                aria-hidden="true"
                              />
                              <div>
                                <div className="font-medium text-rose-700 dark:text-rose-300">
                                  Processing error
                                </div>
                                <div className="mt-0.5 font-mono text-xs text-rose-600 dark:text-rose-400">
                                  {row.processingError}
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                            <DetailKV
                              label="Object type"
                              value={row.objectType ?? "—"}
                            />
                            <DetailKV
                              label="Lago object id"
                              value={row.lagoObjectId ?? "—"}
                            />
                            <DetailKV
                              label="Processed"
                              value={formatDate(row.processedAt)}
                            />
                            {row.replayedFromId !== null && (
                              <>
                                <DetailKV
                                  label="Replayed from"
                                  value={`#${row.replayedFromId}`}
                                />
                                <DetailKV
                                  label="Replayed at"
                                  value={formatDate(row.replayedAt)}
                                />
                                <DetailKV
                                  label="Replayed by"
                                  value={row.replayedByUserId ?? "—"}
                                />
                              </>
                            )}
                          </div>
                          <PayloadViewer
                            payload={payloadCache.value[row.id] ?? {
                              note: "Loading payload…",
                              eventId: row.id,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleDot className="size-3" aria-hidden="true" />
          <span>
            {items.value.filter((i) => deriveWebhookStatus(i) === "failed")
              .length} failed ·{" "}
            {items.value.filter((i) => deriveWebhookStatus(i) === "skipped")
              .length} skipped
          </span>
        </div>
        {canLoadMore.value && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore()}
            disabled={loading.value}
            className="gap-2"
          >
            {loading.value
              ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              : <CheckCircle2 className="size-4" aria-hidden="true" />}
            Load more
          </Button>
        )}
      </div>

      {/* Single replay confirm */}
      <Dialog
        open={confirmReplayId.value !== null}
        onOpenChange={(open) => {
          if (!open) confirmReplayId.value = null;
        }}
      >
        <DialogContent
          onClose={() => {
            confirmReplayId.value = null;
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Replay webhook event #{confirmReplayId.value}?
            </DialogTitle>
            <DialogDescription>
              This may re-trigger notifications or create duplicates if handlers
              aren't idempotent. A new audit row will be created, tagged with
              your user id.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              autoFocus
              variant="outline"
              onClick={() => {
                confirmReplayId.value = null;
              }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => {
                const id = confirmReplayId.value;
                if (id !== null) handleReplay(id);
              }}
            >
              Replay event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk replay confirm */}
      <Dialog
        open={confirmBulkReplay.value}
        onOpenChange={(open) => {
          if (!open) confirmBulkReplay.value = false;
        }}
      >
        <DialogContent
          onClose={() => {
            confirmBulkReplay.value = false;
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Replay {selected.value.size} selected events?
            </DialogTitle>
            <DialogDescription>
              This may re-trigger notifications or create duplicates if handlers
              aren't idempotent. Events are replayed sequentially in received
              order; you'll see a summary when it finishes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              autoFocus
              variant="outline"
              onClick={() => {
                confirmBulkReplay.value = false;
              }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => handleBulkReplay()}
              disabled={loading.value}
            >
              Replay {selected.value.size} events
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
