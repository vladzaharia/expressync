/**
 * NotificationBell (Phase P1)
 *
 * Header-mounted bell that surfaces the unread count + a last-5 dropdown.
 * Mounted inside `AppSidebar` on both mobile (top bar) and desktop (footer).
 *
 * Behaviours:
 *   - Polls `GET /api/notifications/unread-count` every 30s AND on visibility
 *     change. Post-MVP: swap for SSE via `/api/notifications/stream`.
 *   - Opens a dropdown fetching `GET /api/notifications/unread?limit=5`.
 *   - Row click → `PATCH /api/notifications/{id}` with `{ action: "mark_read" }`,
 *     navigate to `sourceUrl` (or `/notifications` when null), close dropdown.
 *   - "Mark all read" → `POST /api/notifications/mark-all-read`.
 *   - Dropdown closes on Esc, outside click, and route change.
 *   - Badge capped at "99+"; hidden when count == 0.
 *
 * Accessibility:
 *   - Trigger: `aria-label="Notifications, {count} unread"`.
 *   - Badge: `aria-live="polite"` so count changes are announced.
 *   - Dropdown: `role="menu"`; rows are `role="menuitem"`; focus returns to
 *     the bell button on close.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Bell } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  NotificationRow,
  type NotificationRowItem,
} from "@/components/notifications/NotificationRow.tsx";
import { toast } from "sonner";

const CHROME_SIZE = "3.5rem";
const POLL_INTERVAL_MS = 30_000;
const DROPDOWN_LIMIT = 5;

interface NotificationBellProps {
  /** `"mobile" | "desktop"` — drives chrome sizing + tooltip placement. */
  variant?: "mobile" | "desktop";
  /** Show the label next to the icon (expanded desktop sidebar). */
  isCollapsed?: boolean;
}

export default function NotificationBell({
  variant = "desktop",
  isCollapsed = true,
}: NotificationBellProps) {
  const unreadCount = useSignal<number>(0);
  const dropdownOpen = useSignal<boolean>(false);
  const loadingList = useSignal<boolean>(false);
  const items = useSignal<NotificationRowItem[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const displayCount = useComputed(() => {
    const n = unreadCount.value;
    if (n <= 0) return null;
    if (n > 99) return "99+";
    return String(n);
  });

  // ---- Poll unread count -------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const res = await fetch("/api/notifications/unread-count", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.count === "number") {
          unreadCount.value = data.count;
        }
      } catch {
        // Silent — badge will just stay at its last-known value.
      }
    };

    fetchCount();
    const intervalId = globalThis.setInterval(fetchCount, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      globalThis.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ---- Dropdown: Esc + outside click + route change ----------------------
  useEffect(() => {
    if (!dropdownOpen.value) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dropdownOpen.value = false;
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !dropdownRef.current?.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        dropdownOpen.value = false;
      }
    };
    const onPopState = () => {
      dropdownOpen.value = false;
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    globalThis.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      globalThis.removeEventListener("popstate", onPopState);
    };
  }, [dropdownOpen.value]);

  // ---- Fetch list when dropdown opens ------------------------------------
  const loadList = async () => {
    loadingList.value = true;
    try {
      const res = await fetch(
        `/api/notifications/unread?limit=${DROPDOWN_LIMIT}`,
        { credentials: "same-origin" },
      );
      if (res.ok) {
        const data = await res.json();
        items.value = Array.isArray(data.items) ? data.items : [];
      } else {
        items.value = [];
      }
    } catch {
      items.value = [];
    } finally {
      loadingList.value = false;
    }
  };

  const handleToggle = () => {
    const next = !dropdownOpen.value;
    dropdownOpen.value = next;
    if (next) loadList();
  };

  const handleRowActivate = async (n: NotificationRowItem) => {
    // Optimistic: decrement count and flip read before the request lands.
    unreadCount.value = Math.max(0, unreadCount.value - 1);
    items.value = items.value.filter((x) => x.id !== n.id);

    try {
      await fetch(`/api/notifications/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read" }),
        credentials: "same-origin",
      });
    } catch {
      // Non-fatal: polling will reconcile.
    }

    dropdownOpen.value = false;
    const href = n.sourceUrl ?? "/notifications";
    if (href.startsWith("http")) {
      globalThis.open(href, "_blank", "noopener,noreferrer");
    } else {
      globalThis.location.href = href;
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = await res.json();
        unreadCount.value = 0;
        items.value = [];
        toast.success(
          `${data.updated ?? 0} notification${
            data.updated === 1 ? "" : "s"
          } marked read`,
        );
      } else {
        toast.error("Failed to mark notifications read");
      }
    } catch {
      toast.error("Failed to mark notifications read");
    }
  };

  const ariaLabel = `Notifications, ${unreadCount.value} unread`;

  const triggerSquare = (
    <button
      ref={triggerRef}
      type="button"
      onClick={handleToggle}
      aria-haspopup="menu"
      aria-expanded={dropdownOpen.value}
      aria-label={ariaLabel}
      className={cn(
        "relative flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer",
      )}
      style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
    >
      <Bell className="size-5" aria-hidden="true" />
      {displayCount.value !== null && (
        <span
          aria-live="polite"
          aria-atomic="true"
          className="absolute top-2 right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-5 text-center tabular-nums shadow-sm"
        >
          {displayCount.value}
        </span>
      )}
    </button>
  );

  const triggerFull = (
    <button
      ref={triggerRef}
      type="button"
      onClick={handleToggle}
      aria-haspopup="menu"
      aria-expanded={dropdownOpen.value}
      aria-label={ariaLabel}
      className={cn(
        "relative flex items-center border-t hover:bg-muted/50 transition-colors cursor-pointer shrink-0 w-full text-muted-foreground hover:text-foreground gap-3 px-4",
      )}
      style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
    >
      <span className="relative inline-flex items-center justify-center shrink-0">
        <Bell className="size-5" aria-hidden="true" />
        {displayCount.value !== null && (
          <span
            aria-live="polite"
            aria-atomic="true"
            className="absolute -top-1.5 -right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-5 text-center tabular-nums shadow-sm"
          >
            {displayCount.value}
          </span>
        )}
      </span>
      <span className="text-sm font-medium">Notifications</span>
    </button>
  );

  const trigger = variant === "mobile" || isCollapsed
    ? triggerSquare
    : triggerFull;

  return (
    <div className="relative shrink-0">
      {trigger}

      {dropdownOpen.value && (
        <div
          ref={dropdownRef}
          role="menu"
          aria-label="Recent notifications"
          className={cn(
            "absolute z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-lg border bg-popover shadow-lg overflow-hidden",
            variant === "mobile"
              ? "top-full right-0 mt-1"
              : isCollapsed
              ? "bottom-0 left-full ml-2"
              : "bottom-full left-0 mb-1",
          )}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-medium">Notifications</span>
            {unreadCount.value > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-1"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[28rem] overflow-y-auto">
            {loadingList.value
              ? (
                <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                  Loading…
                </div>
              )
              : items.value.length === 0
              ? (
                <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                  You're all caught up.
                </div>
              )
              : (
                <ul className="py-1">
                  {items.value.map((n) => (
                    <li key={n.id} role="none">
                      <div role="menuitem">
                        <NotificationRow
                          notification={n}
                          compact
                          onActivate={handleRowActivate}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </div>

          <div className="border-t px-3 py-2">
            <a
              href="/notifications"
              className="text-xs text-sky-600 dark:text-sky-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              View all notifications →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
