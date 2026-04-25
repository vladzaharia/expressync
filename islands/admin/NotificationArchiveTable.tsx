/**
 * NotificationArchiveTable (Phase P1)
 *
 * Paginated + filtered table rendered on `/notifications`. Renders each row
 * via `NotificationRow` and wraps the whole block in `role="region"` so
 * keyboard users can tab-through the horizontal scroll area.
 *
 * Filters are URL-free for MVP — changing a filter refetches in place. Post
 * MVP we can sync to `window.history.replaceState(...)` for shareable links.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  NotificationRow,
  type NotificationRowItem,
} from "@/components/notifications/NotificationRow.tsx";
import { Check, CheckCheck, Loader2, Trash2 } from "lucide-preact";
import { clientNavigate } from "@/src/lib/nav.ts";

type SeverityFilter = "all" | "info" | "success" | "warn" | "error";
type ReadFilter = "any" | "unread" | "read";

const PAGE_SIZE = 25;

interface Props {
  initialItems: NotificationRowItem[];
  initialTotal: number;
}

export default function NotificationArchiveTable(
  { initialItems, initialTotal }: Props,
) {
  const items = useSignal<NotificationRowItem[]>(initialItems);
  const total = useSignal<number>(initialTotal);
  const loading = useSignal<boolean>(false);
  const loadingMore = useSignal<boolean>(false);
  const severity = useSignal<SeverityFilter>("all");
  const readState = useSignal<ReadFilter>("any");
  const markingAll = useSignal<boolean>(false);

  const unreadCount = useComputed(
    () => items.value.filter((n) => n.readAt === null).length,
  );

  const buildUrl = (offset: number, limit: number) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("skip", String(offset));
    if (severity.value !== "all") params.set("severity", severity.value);
    if (readState.value !== "any") params.set("readState", readState.value);
    return `/api/admin/notifications?${params.toString()}`;
  };

  // Refetch whenever filters change.
  useEffect(() => {
    let cancelled = false;
    const fetchInitial = async () => {
      loading.value = true;
      try {
        const res = await fetch(buildUrl(0, PAGE_SIZE), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (cancelled) return;
        items.value = Array.isArray(data.items) ? data.items : [];
        total.value = typeof data.total === "number" ? data.total : 0;
      } catch {
        if (!cancelled) toast.error("Failed to load notifications");
      } finally {
        if (!cancelled) loading.value = false;
      }
    };
    fetchInitial();
    return () => {
      cancelled = true;
    };
  }, [severity.value, readState.value]);

  const loadMore = async () => {
    if (loadingMore.value) return;
    loadingMore.value = true;
    try {
      const res = await fetch(buildUrl(items.value.length, PAGE_SIZE), {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const more: NotificationRowItem[] = Array.isArray(data.items)
        ? data.items
        : [];
      items.value = [...items.value, ...more];
      if (typeof data.total === "number") total.value = data.total;
    } catch {
      toast.error("Failed to load more");
    } finally {
      loadingMore.value = false;
    }
  };

  const markReadAndNavigate = async (n: NotificationRowItem) => {
    // Optimistic
    items.value = items.value.map((x) =>
      x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x
    );
    try {
      await fetch(`/api/admin/notifications/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read" }),
        credentials: "same-origin",
      });
    } catch {
      // Non-fatal
    }
    if (n.sourceUrl) {
      if (n.sourceUrl.startsWith("http")) {
        globalThis.open(n.sourceUrl, "_blank", "noopener,noreferrer");
      } else {
        clientNavigate(n.sourceUrl);
      }
    }
  };

  const dismissRow = async (id: number) => {
    // Optimistic
    const prev = items.value;
    items.value = items.value.filter((x) => x.id !== id);
    total.value = Math.max(0, total.value - 1);
    try {
      const res = await fetch(`/api/admin/notifications/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      toast.error("Failed to dismiss notification");
      items.value = prev;
    }
  };

  const handleMarkAllRead = async () => {
    markingAll.value = true;
    try {
      const res = await fetch("/api/admin/notifications/mark-all-read", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = await res.json();
        const now = new Date().toISOString();
        items.value = items.value.map((x) =>
          x.readAt ? x : { ...x, readAt: now }
        );
        toast.success(
          `${data.updated ?? 0} notification${
            data.updated === 1 ? "" : "s"
          } marked read`,
        );
      } else {
        toast.error("Failed to mark all read");
      }
    } catch {
      toast.error("Failed to mark all read");
    } finally {
      markingAll.value = false;
    }
  };

  return (
    <div
      role="region"
      aria-label="Notifications archive"
      tabIndex={0}
      className="space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
    >
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Severity</span>
          <Select
            value={severity.value}
            onValueChange={(
              v: string,
            ) => (severity.value = v as SeverityFilter)}
          >
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="warn">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Read state</span>
          <Select
            value={readState.value}
            onValueChange={(v: string) => (readState.value = v as ReadFilter)}
          >
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="unread">Unread only</SelectItem>
              <SelectItem value="read">Read only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Badge variant="outline" className="gap-1">
            <Check className="size-3" aria-hidden="true" />
            {unreadCount.value} unread on page
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleMarkAllRead}
            disabled={markingAll.value}
          >
            {markingAll.value
              ? <Loader2 className="size-4 animate-spin" />
              : <CheckCheck className="size-4" />}
            Mark all read
          </Button>
        </div>
      </div>

      {/* List */}
      {loading.value
        ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Loading notifications…
          </div>
        )
        : items.value.length === 0
        ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No notifications match these filters.
          </div>
        )
        : (
          <ul className="divide-y rounded-md border">
            {items.value.map((n) => (
              <li key={n.id} className="group relative">
                <NotificationRow
                  notification={n}
                  onActivate={markReadAndNavigate}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissRow(n.id);
                  }}
                  aria-label={`Dismiss notification: ${n.title}`}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-md text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

      {/* Footer */}
      <div className="flex items-center justify-between px-2">
        <p className="text-xs text-muted-foreground">
          Showing {items.value.length} of {total.value}
        </p>
        {items.value.length < total.value && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={loadMore}
            disabled={loadingMore.value}
          >
            {loadingMore.value
              ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Loading…
                </>
              )
              : (
                "Load more"
              )}
          </Button>
        )}
      </div>
    </div>
  );
}
