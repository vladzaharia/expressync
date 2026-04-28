/**
 * DeviceFiltersBar — query filters for `/admin/devices`.
 *
 * Three filter axes:
 *   - kind     → all | phone_nfc | laptop_nfc
 *   - online   → any | online | offline
 *   - owner    → free-text search (passed back to the server as `ownerId`
 *                or `q`; the listing handler supports `ownerId` directly).
 *
 * The bar always renders (per CLAUDE.md "filter bar renders unconditionally"
 * rule) — we never reflow the page based on whether a filter is active.
 *
 * Form-submit driven, server round-trip: each <select>/<input> writes to a
 * single GET form so the browser owns navigation state. No client signals
 * required, so this lives in `components/` (not `islands/`) and ships as
 * static HTML.
 */

import { Filter } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export type DeviceTypeFilter = "all" | "charger" | "scanner";
export type DeviceKindFilter =
  | "all"
  | "phone_nfc"
  | "tablet_nfc"
  | "laptop_nfc";
export type DeviceOnlineFilter = "any" | "online" | "offline";

export interface DeviceFiltersBarProps {
  /** Current filter values (read from the page URL). */
  initial: {
    type: DeviceTypeFilter;
    kind: DeviceKindFilter;
    online: DeviceOnlineFilter;
    owner: string;
  };
  /** Total un-filtered count for the "showing X of Y" hint. */
  totalCount?: number;
  class?: string;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: DeviceTypeFilter; label: string }> =
  [
    { value: "all", label: "All types" },
    { value: "charger", label: "Chargers" },
    { value: "scanner", label: "Scanners" },
  ];

const KIND_OPTIONS: ReadonlyArray<{ value: DeviceKindFilter; label: string }> =
  [
    { value: "all", label: "All kinds" },
    { value: "phone_nfc", label: "Phones" },
    { value: "tablet_nfc", label: "Tablets" },
    { value: "laptop_nfc", label: "Laptops" },
  ];

const ONLINE_OPTIONS: ReadonlyArray<
  { value: DeviceOnlineFilter; label: string }
> = [
  { value: "any", label: "Any status" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
];

export function DeviceFiltersBar(
  { initial, totalCount, class: className }: DeviceFiltersBarProps,
) {
  const hasActive = initial.type !== "all" || initial.kind !== "all" ||
    initial.online !== "any" || initial.owner.trim().length > 0;

  return (
    <form
      method="get"
      action="/admin/devices"
      class={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2",
        className,
      )}
    >
      <span class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Filter class="size-3.5" aria-hidden="true" />
        Filters
      </span>

      <label class="inline-flex items-center gap-1.5 text-sm">
        <span class="sr-only">Type</span>
        <select
          name="type"
          class="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              selected={opt.value === initial.type}
            >
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label class="inline-flex items-center gap-1.5 text-sm">
        <span class="sr-only">Kind</span>
        <select
          name="kind"
          class="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {KIND_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              selected={opt.value === initial.kind}
            >
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label class="inline-flex items-center gap-1.5 text-sm">
        <span class="sr-only">Online</span>
        <select
          name="online"
          class="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {ONLINE_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              selected={opt.value === initial.online}
            >
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label class="inline-flex flex-1 items-center gap-1.5 text-sm min-w-[12rem]">
        <span class="sr-only">Owner search</span>
        <Input
          type="search"
          name="owner"
          placeholder="Search by owner ID…"
          value={initial.owner}
          class="h-8"
        />
      </label>

      <Button type="submit" size="sm" variant="default">
        Apply
      </Button>

      {hasActive && (
        <Button type="button" size="sm" variant="outline" asChild>
          <a href="/admin/devices">Clear</a>
        </Button>
      )}

      {totalCount !== undefined && (
        <span class="ml-auto text-xs text-muted-foreground tabular-nums">
          {totalCount} device{totalCount === 1 ? "" : "s"}
        </span>
      )}
    </form>
  );
}
