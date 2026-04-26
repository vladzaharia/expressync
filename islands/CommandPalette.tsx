/**
 * CommandPalette (Phase P6) — global ⌘K/Ctrl+K/`/` launcher.
 *
 * Mounted once from `routes/_app.tsx` as a top-level body child. Renders
 * nothing until the user opens it; then a full-screen backdrop + centered
 * panel (mobile: full-screen sheet) appear with:
 *   - Recent (localStorage `cmdk.recent`, 10 items)
 *   - Navigate  (static — every `mainNavItems` entry)
 *   - Actions   (static — Trigger sync, Create reservation, etc.)
 *   - Dynamic entity groups (chargers, tags, customers, invoices,
 *     reservations, sync runs) driven by POST /api/command-palette/search
 *     with a 150 ms debounce.
 *
 * Hotkeys (see `src/lib/command-palette/hotkeys.ts`):
 *   ⌘K / Ctrl+K   toggle
 *   /              open (non-input pages)
 *   Esc            close
 *   ⌘/Ctrl+Enter  execute + keep palette open (chained actions)
 *
 * Admin guard: the search endpoint returns 403 for non-admins; the palette
 * silently falls back to nav+actions in that case. The mobile trigger in
 * `AppSidebar` is gated separately.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { Command } from "cmdk";
import { toast } from "sonner";
import {
  BatteryCharging,
  CalendarClock,
  Clock,
  FileText,
  Radio,
  Receipt,
  RefreshCw,
  Tag,
  User as UserIcon,
  Users,
  Zap,
} from "lucide-preact";
import { attachPaletteHotkeys } from "@/src/lib/command-palette/hotkeys.ts";
import {
  type ActionEnv,
  buildActionCommands,
  buildNavigateCommands,
  type PaletteCommand,
} from "@/src/lib/command-palette/commands.ts";
import {
  buildCustomerActionCommands,
  buildCustomerNavigateCommands,
  type CustomerActionEnv,
} from "@/src/lib/command-palette/customer-commands.ts";
import { CommandGroup } from "@/components/command-palette/CommandGroup.tsx";
import { CommandItem } from "@/components/command-palette/CommandItem.tsx";
import type { CommandSearchResponse } from "@/routes/api/admin/command-palette/search.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

/**
 * Polaris Track H — surface the palette is mounted in. Customer surface
 * uses the customer command registry + scoped search endpoint; admin
 * surface keeps the existing behavior.
 */
export type CommandPaletteSurface = "admin" | "customer";

interface CommandPaletteProps {
  /**
   * Which surface this palette belongs to. Defaults to "admin" so the
   * existing single-call site in `_app.tsx` keeps working unchanged
   * until the parent threads through `state.surface`.
   */
  surface?: CommandPaletteSurface;
}

const RECENT_KEY = "cmdk.recent";
const RECENT_MIGRATED_KEY = "cmdk.recent.migrated_v1";
const RECENT_LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * One-shot migration for Recent LRU entries stored before Wave A4:
 *   - Old ids used label-style keys ("nav:transactions"); rewrite to
 *     path-style ("nav:/transactions") which is the new stable id shape.
 *   - Title "Transactions" was renamed to "Charging Sessions".
 * Gated by `cmdk.recent.migrated_v1` so it only runs once per browser.
 */
function migrateRecentV1() {
  try {
    if (localStorage.getItem(RECENT_MIGRATED_KEY) === "true") return;
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Map of legacy id -> new id (derived from old label-style keys).
        const idMap: Record<string, string> = {
          "nav:dashboard": "nav:/",
          "nav:tags": "nav:/tags",
          "nav:tag-linking": "nav:/links",
          "nav:transactions": "nav:/transactions",
          "nav:invoices": "nav:/invoices",
          "nav:chargers": "nav:/chargers",
          "nav:sync": "nav:/sync",
          "nav:users": "nav:/users",
          "nav:reservations": "nav:/reservations",
        };
        const migrated = parsed.map((e) => {
          if (!e || typeof e !== "object") return e;
          const entry = e as Record<string, unknown>;
          if (typeof entry.id === "string" && idMap[entry.id]) {
            entry.id = idMap[entry.id];
          }
          if (entry.title === "Transactions") {
            entry.title = "Charging Sessions";
          }
          return entry;
        });
        localStorage.setItem(RECENT_KEY, JSON.stringify(migrated));
      }
    }
    localStorage.setItem(RECENT_MIGRATED_KEY, "true");
  } catch {
    /* ignore storage errors */
  }
}

interface RecentEntry {
  id: string;
  title: string;
  href: string;
  subtitle?: string;
}

function navigate(href: string) {
  clientNavigate(href);
}

function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is RecentEntry =>
        e && typeof e === "object" && typeof e.id === "string" &&
        typeof e.title === "string" && typeof e.href === "string"
      )
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function pushRecent(entry: RecentEntry) {
  try {
    const current = loadRecent().filter((e) => e.id !== entry.id);
    current.unshift(entry);
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(current.slice(0, RECENT_LIMIT)),
    );
  } catch {
    /* ignore storage errors */
  }
}

interface ScanPickerCharger {
  chargeBoxId: string;
  friendlyName: string | null;
  status: string | null;
}

export default function CommandPalette(
  { surface = "admin" }: CommandPaletteProps = {},
) {
  const open = useSignal(false);
  const query = useSignal("");
  const searchResults = useSignal<CommandSearchResponse | null>(null);
  const searchLoading = useSignal(false);
  const recent = useSignal<RecentEntry[]>([]);
  const triggeringElement = useRef<Element | null>(null);
  // Sub-page state for the "Scan EV Card" two-step flow. When non-null,
  // the palette body switches from search results to a charger picker.
  // `loading=true` while the GET /api/auth/scan-tap-targets call is in
  // flight; `chargers` is the filtered (online-only) list when present.
  const scanPicker = useSignal<
    | { loading: true; chargers: null }
    | { loading: false; chargers: ScanPickerCharger[] }
    | null
  >(null);

  const isCustomer = surface === "customer";

  // Polaris Track H: pick the right command registries per surface. The
  // admin path stays untouched; the customer path swaps in the
  // customer-safe nav + actions (Start charging, Stop, New reservation,
  // …).
  const navigateCommands = useMemo<PaletteCommand[]>(
    () =>
      isCustomer ? buildCustomerNavigateCommands() : buildNavigateCommands(),
    [isCustomer],
  );

  const adminActionEnv: ActionEnv = useMemo(() => ({
    toast: {
      promise: (p, opts) => toast.promise(p, opts),
      success: (m) => toast.success(m),
      error: (m) => toast.error(m),
    },
    navigate,
  }), []);

  const customerActionEnv: CustomerActionEnv = useMemo(() => ({
    toast: {
      promise: (p, opts) => toast.promise(p, opts),
      success: (m) => toast.success(m),
      error: (m) => toast.error(m),
    },
    navigate,
    // Scan-modal trigger is owned by the dashboard island once it lands;
    // for MVP we leave this undefined so the action falls back to a
    // dashboard hop.
    openScanModal: undefined,
  }), []);

  const actionCommands = useMemo<PaletteCommand[]>(
    () =>
      isCustomer
        ? buildCustomerActionCommands(customerActionEnv)
        : buildActionCommands(adminActionEnv),
    [isCustomer, adminActionEnv, customerActionEnv],
  );

  // Polaris Track H: surface-aware search endpoint. Customer routes are
  // scoped to the authenticated user via `resolveCustomerScope`; admin
  // route is the existing one. Falling back to admin keeps existing
  // tests + behavior untouched.
  const searchEndpoint = isCustomer
    ? "/api/customer/command-palette/search"
    : "/api/admin/command-palette/search";

  // -- Hotkeys -----------------------------------------------------------
  useEffect(() => {
    const detach = attachPaletteHotkeys({
      isOpen: () => open.value,
      open: () => {
        migrateRecentV1();
        triggeringElement.current = document.activeElement;
        open.value = true;
        recent.value = loadRecent();
      },
      close: () => {
        open.value = false;
        query.value = "";
        searchResults.value = null;
        const el = triggeringElement.current;
        if (
          el && "focus" in el && typeof (el as HTMLElement).focus === "function"
        ) {
          (el as HTMLElement).focus();
        }
      },
    });
    return detach;
  }, []);

  // -- Manual "Open command palette" trigger via custom event ------------
  // Other components (e.g. AppSidebar mobile trigger) can fire
  // `window.dispatchEvent(new CustomEvent('cmdk:open'))` without importing
  // this island directly.
  useEffect(() => {
    const onOpen = () => {
      if (!open.value) {
        migrateRecentV1();
        triggeringElement.current = document.activeElement;
        open.value = true;
        recent.value = loadRecent();
      }
    };
    globalThis.addEventListener("cmdk:open", onOpen);
    return () => globalThis.removeEventListener("cmdk:open", onOpen);
  }, []);

  // -- Auto-close on route change (Fresh full-reload nav fires beforeunload)
  useEffect(() => {
    const onBeforeUnload = () => {
      open.value = false;
    };
    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // -- Scan EV Card flow: action dispatches `cmdk:scan-picker:open`; we
  //    fetch the online charger roster and either auto-arm (1 online) or
  //    switch to the inline picker subview (>1 online).
  useEffect(() => {
    const onScanPickerOpen = async () => {
      // Skip on customer surface — admin scan inventory only.
      if (isCustomer) return;
      scanPicker.value = { loading: true, chargers: null };
      try {
        const res = await fetch("/api/auth/scan-tap-targets", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        // Wave 2 response shape: `{ devices: TapTargetEntry[] }`. The
        // palette's "Scan EV Card" flow only knows how to arm at a charger,
        // so we filter to `pairableType === 'charger'` rows and map them
        // back to the legacy ScanPickerCharger fields. D3 (Wave 4) extends
        // this surface to surface phone targets too.
        const data = await res.json() as {
          devices: Array<{
            deviceId: string;
            pairableType: "device" | "charger";
            kind: "charger" | "phone_nfc" | "laptop_nfc";
            label: string;
            isOnline: boolean;
          }>;
        };
        const online = (data.devices ?? []).filter(
          (d) => d.pairableType === "charger" && d.isOnline,
        );
        if (online.length === 0) {
          scanPicker.value = null;
          toast.error("No chargers online", {
            description:
              "Wait for a charger to come back online and try again.",
          });
          return;
        }
        if (online.length === 1) {
          // Single charger — skip the picker and go straight to scan UX.
          const c = online[0];
          scanPicker.value = null;
          close();
          globalThis.dispatchEvent(
            new CustomEvent("evcard:scan-open", {
              detail: { chargeBoxId: c.deviceId },
            }),
          );
          return;
        }
        // Multiple chargers — switch the palette body to the picker subview.
        scanPicker.value = {
          loading: false,
          chargers: online.map((c) => ({
            chargeBoxId: c.deviceId,
            friendlyName: c.label,
            status: null,
          })),
        };
        // Reset query so the picker isn't pre-filtered by whatever the
        // user typed before invoking the action.
        query.value = "";
      } catch (err) {
        scanPicker.value = null;
        console.warn("[cmdk] scan-picker fetch failed", err);
        toast.error("Couldn't load charger list");
      }
    };
    globalThis.addEventListener(
      "cmdk:scan-picker:open",
      onScanPickerOpen as EventListener,
    );
    return () =>
      globalThis.removeEventListener(
        "cmdk:scan-picker:open",
        onScanPickerOpen as EventListener,
      );
  }, [isCustomer]);

  /** Close + dispatch scan-open with a chosen charger. */
  const armScanAt = (chargeBoxId: string) => {
    scanPicker.value = null;
    close();
    globalThis.dispatchEvent(
      new CustomEvent("evcard:scan-open", { detail: { chargeBoxId } }),
    );
  };

  // -- Debounced search --------------------------------------------------
  useEffect(() => {
    if (!open.value) return;
    const q = query.value.trim();
    if (!q) {
      searchResults.value = null;
      searchLoading.value = false;
      return;
    }
    searchLoading.value = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(searchEndpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // 403 for non-admin — silently leave entity results empty.
          searchResults.value = null;
          return;
        }
        const data = (await res.json()) as CommandSearchResponse;
        searchResults.value = data;
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          // Log but don't surface; palette continues working with static cmds.
          console.warn("[cmdk] search failed", err);
        }
      } finally {
        searchLoading.value = false;
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open.value, query.value, searchEndpoint]);

  // -- Close helper ------------------------------------------------------
  const close = () => {
    open.value = false;
    query.value = "";
    searchResults.value = null;
    scanPicker.value = null;
    const el = triggeringElement.current;
    if (
      el && "focus" in el && typeof (el as HTMLElement).focus === "function"
    ) {
      (el as HTMLElement).focus();
    }
  };

  /** Drop the scan-picker subview without closing the palette. */
  const dismissScanPicker = () => {
    scanPicker.value = null;
  };

  // -- Execute a command (navigate or action) ---------------------------
  const execute = (cmd: PaletteCommand, evt?: KeyboardEvent | MouseEvent) => {
    const keepOpen = !!evt && (evt as KeyboardEvent).metaKey ||
      !!evt && (evt as KeyboardEvent).ctrlKey;

    if (cmd.kind === "navigate" && cmd.href) {
      pushRecent({
        id: cmd.id,
        title: cmd.title,
        href: cmd.href,
        subtitle: cmd.subtitle,
      });
      close();
      navigate(cmd.href);
      return;
    }
    if (cmd.kind === "action" && cmd.run) {
      pushRecent({
        id: cmd.id,
        title: cmd.title,
        href: "",
        subtitle: cmd.subtitle,
      });
      try {
        cmd.run(keepOpen);
      } catch (err) {
        toast.error("Action failed");
        console.error("[cmdk] action failed", err);
      }
      if (!keepOpen && !cmd.keepOpenAfterRun) close();
    }
  };

  const executeRecent = (entry: RecentEntry) => {
    if (!entry.href) {
      // Recent action with no href — no-op; user can re-run from Actions group.
      close();
      return;
    }
    close();
    navigate(entry.href);
  };

  // -- Entity hit execution ---------------------------------------------
  const executeHit = (
    hit: { id: string; label: string; href: string; subtitle?: string },
    group: string,
  ) => {
    pushRecent({
      id: `${group}:${hit.id}`,
      title: hit.label,
      href: hit.href,
      subtitle: hit.subtitle,
    });
    close();
    navigate(hit.href);
  };

  const resultsCount = useComputed(() => {
    const r = searchResults.value;
    if (!r) return 0;
    return r.chargers.length + r.tags.length + r.customers.length +
      r.invoices.length + r.reservations.length + r.syncRuns.length +
      (r.users?.length ?? 0) + (r.transactions?.length ?? 0);
  });

  if (!open.value) return null;

  const results = searchResults.value;
  const hasQuery = query.value.trim().length > 0;

  return (
    <div
      class="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 backdrop-blur-sm pt-[10vh] px-0 sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        class="w-full sm:max-w-[600px] sm:rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden h-full sm:h-auto sm:max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          label="Command palette"
          shouldFilter
          className="flex flex-col flex-1 min-h-0"
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
            {scanPicker.value && (
              <span class="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300 shrink-0">
                <Radio class="size-3" aria-hidden="true" />
                Scan
              </span>
            )}
            <Command.Input
              autoFocus
              value={query.value}
              onValueChange={(v: string) => (query.value = v)}
              placeholder={scanPicker.value
                ? "Search chargers..."
                : "Type exact tag names, charger IDs, or action names..."}
              className="flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-muted-foreground"
              role="combobox"
              aria-expanded
              aria-controls="cmdk-list"
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  // Esc backs out of the scan-picker subview before closing
                  // the whole palette — gives the user a way to bail without
                  // losing context.
                  if (scanPicker.value) {
                    dismissScanPicker();
                  } else {
                    close();
                  }
                }
              }}
            />
            {(searchLoading.value || scanPicker.value?.loading) && (
              <span class="text-xs text-muted-foreground shrink-0">...</span>
            )}
            <kbd class="hidden sm:inline-flex items-center text-[10px] px-1.5 py-0.5 border border-border rounded text-muted-foreground shrink-0">
              Esc
            </kbd>
          </div>

          <div aria-live="polite" aria-atomic="true" class="sr-only">
            {resultsCount.value} results
          </div>

          <Command.List
            id="cmdk-list"
            role="listbox"
            className="flex-1 overflow-y-auto py-1"
          >
            <Command.Empty className="px-4 py-6 text-sm text-muted-foreground text-center">
              {scanPicker.value
                ? "No matching chargers online."
                : `No matches. Try a charger ID, tag name, or "sync".`}
            </Command.Empty>

            {
              /* Scan EV Card subview — when active, replaces the normal
                results stack with a charger picker. Selecting a charger
                closes the palette and arms the TapToAddModal at it. */
            }
            {scanPicker.value && !scanPicker.value.loading &&
              scanPicker.value.chargers && (
              <CommandGroup heading="Pick a charger to scan at">
                {scanPicker.value.chargers.map((c) => (
                  <CommandItem
                    key={`scan-pick:${c.chargeBoxId}`}
                    value={`scan-pick:${c.chargeBoxId}:${c.friendlyName ?? ""}`}
                    icon={Radio}
                    accent="cyan"
                    title={c.friendlyName?.trim() || c.chargeBoxId}
                    subtitle={c.friendlyName ? c.chargeBoxId : (c.status ?? "")}
                    onSelect={() => armScanAt(c.chargeBoxId)}
                  />
                ))}
              </CommandGroup>
            )}

            {/* Recent — only on empty query */}
            {!scanPicker.value && !hasQuery && recent.value.length > 0 && (
              <CommandGroup heading="Recent">
                {recent.value.map((r) => (
                  <CommandItem
                    key={`recent:${r.id}`}
                    value={`recent:${r.id}`}
                    icon={Clock}
                    accent="neutral"
                    title={r.title}
                    subtitle={r.subtitle}
                    onSelect={() => executeRecent(r)}
                  />
                ))}
              </CommandGroup>
            )}

            {
              /* Navigate + Actions + dynamic results — hidden while the
                Scan EV Card subview is open so the operator only sees
                charger options during that flow. */
            }
            {!scanPicker.value && (
              <>
                <CommandGroup heading="Navigate">
                  {navigateCommands.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      keywords={[c.title, ...(c.keywords ?? [])]}
                      icon={c.icon}
                      accent={c.accent}
                      title={c.title}
                      subtitle={c.subtitle}
                      onSelect={() => execute(c)}
                    />
                  ))}
                </CommandGroup>

                <CommandGroup heading="Actions">
                  {actionCommands.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      keywords={[c.title, ...(c.keywords ?? [])]}
                      icon={c.icon}
                      accent={c.accent}
                      title={c.title}
                      subtitle={c.subtitle}
                      onSelect={() => execute(c)}
                    />
                  ))}
                </CommandGroup>
              </>
            )}

            {/* Dynamic entities — only when there's a query */}
            {!scanPicker.value && hasQuery && results && (
              <>
                {results.chargers.length > 0 && (
                  <CommandGroup heading="Chargers">
                    {results.chargers.map((h) => (
                      <CommandItem
                        key={`charger:${h.id}`}
                        value={`charger:${h.id}:${h.label}`}
                        icon={BatteryCharging}
                        accent="orange"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "charger")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.tags.length > 0 && (
                  <CommandGroup heading="Tags">
                    {results.tags.map((h) => (
                      <CommandItem
                        key={`tag:${h.id}`}
                        value={`tag:${h.id}:${h.label}`}
                        icon={Tag}
                        accent="cyan"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "tag")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.customers.length > 0 && (
                  <CommandGroup heading="Customers">
                    {results.customers.map((h) => (
                      <CommandItem
                        key={`customer:${h.id}`}
                        value={`customer:${h.id}:${h.label}`}
                        icon={Users}
                        accent="amber"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "customer")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.invoices.length > 0 && (
                  <CommandGroup heading="Invoices">
                    {results.invoices.map((h) => (
                      <CommandItem
                        key={`invoice:${h.id}`}
                        value={`invoice:${h.id}:${h.label}`}
                        icon={FileText}
                        accent="teal"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "invoice")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.reservations.length > 0 && (
                  <CommandGroup heading="Reservations">
                    {results.reservations.map((h) => (
                      <CommandItem
                        key={`reservation:${h.id}`}
                        value={`reservation:${h.id}:${h.label}`}
                        icon={CalendarClock}
                        accent="indigo"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "reservation")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.syncRuns.length > 0 && (
                  <CommandGroup heading="Sync Runs">
                    {results.syncRuns.map((h) => (
                      <CommandItem
                        key={`syncrun:${h.id}`}
                        value={`syncrun:${h.id}:${h.label}`}
                        icon={RefreshCw}
                        accent="blue"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "syncrun")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.users && results.users.length > 0 && (
                  <CommandGroup heading="Users">
                    {results.users.map((h) => (
                      <CommandItem
                        key={`user:${h.id}`}
                        value={`user:${h.id}:${h.label}`}
                        icon={UserIcon}
                        accent="violet"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "user")}
                      />
                    ))}
                  </CommandGroup>
                )}
                {results.transactions && results.transactions.length > 0 && (
                  <CommandGroup heading="Transactions">
                    {results.transactions.map((h) => (
                      <CommandItem
                        key={`txn:${h.id}`}
                        value={`txn:${h.id}:${h.label}`}
                        icon={Zap}
                        accent="emerald"
                        title={h.label}
                        subtitle={h.subtitle}
                        onSelect={() => executeHit(h, "transaction")}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </Command.List>

          <div class="flex items-center justify-between gap-2 px-3 py-2 border-t border-border text-[11px] text-muted-foreground">
            <span class="hidden sm:inline">
              <kbd class="px-1 py-0.5 border border-border rounded">↑↓</kbd>
              {" "}
              navigate{"  "}
              <kbd class="px-1 py-0.5 border border-border rounded">↵</kbd> run
              {"  "}
              <kbd class="px-1 py-0.5 border border-border rounded">⌘↵</kbd>
              {" "}
              keep open
            </span>
            <span class="inline sm:hidden">Tap to select</span>
            <span class="flex items-center gap-1">
              <Receipt class="size-3" aria-hidden="true" />
              <span>ExpresSync</span>
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
