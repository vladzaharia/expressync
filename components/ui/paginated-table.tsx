import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Button } from "./button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.tsx";
import { ChevronDown, Loader2 } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren } from "preact";

/**
 * Match the `<md` breakpoint Tailwind uses (768px). Tracks resize so the
 * mobile-card render flips back to the table on rotate / window-resize
 * without a full reload. Initial render returns `false` (assume desktop)
 * so SSR markup matches the post-hydration desktop view; the mobile flip
 * happens on the first effect tick.
 */
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mql = globalThis.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export interface PaginatedTableColumn<T> {
  key: string;
  header: string;
  className?: string;
  /** Hide this column on mobile devices */
  hideOnMobile?: boolean;
  render: (item: T, index: number) => ComponentChildren;
}

export interface PaginatedTableProps<T> {
  /** Initial items to display */
  initialItems: T[];
  /** Column definitions */
  columns: PaginatedTableColumn<T>[];
  /** Total count of items available (for showing "X of Y") */
  totalCount?: number;
  /** Number of items to show initially and load per page */
  pageSize?: number;
  /** API endpoint to fetch more items */
  fetchUrl?: string;
  /** Extra query params merged into every fetch (e.g. active filters) */
  fetchParams?: Record<string, string>;
  /** Whether to show the Load More button */
  showLoadMore?: boolean;
  /** Custom empty state message */
  emptyMessage?: string;
  /** Row click handler */
  onRowClick?: (item: T, index: number) => void;
  /** Get unique key for each item */
  getItemKey: (item: T) => string | number;
  /** Additional class for the table container */
  className?: string;
  /** Row class name function */
  rowClassName?: (item: T, index: number) => string;
  /** Hide the table header row */
  hideHeader?: boolean;
  /** Hide the "Showing X items" footer text */
  hideFooterText?: boolean;
  /**
   * Polaris Track H — when provided AND the viewport is `<md`, render each
   * item as a stacked card via this callback instead of as a table row. The
   * desktop table is unchanged; column hiding via `hideOnMobile` continues
   * to apply for callers that don't opt into card mode.
   *
   * Whole-card tap routing comes from `onRowClick` (same as the table) — the
   * wrapping `<div>` proxies the click so the same handler fires.
   */
  renderMobileCard?: (item: T, index: number) => ComponentChildren;
}

export function PaginatedTable<T>({
  initialItems,
  columns,
  totalCount,
  pageSize = 15,
  fetchUrl,
  fetchParams,
  showLoadMore = true,
  emptyMessage = "No items found",
  onRowClick,
  getItemKey,
  className,
  rowClassName,
  hideHeader = false,
  hideFooterText = false,
  renderMobileCard,
}: PaginatedTableProps<T>) {
  const items = useSignal<T[]>(initialItems);
  const loading = useSignal(false);
  const isMobile = useIsMobileViewport();
  const hasMore = useComputed(() => {
    if (totalCount === undefined) return items.value.length >= pageSize;
    return items.value.length < totalCount;
  });

  const handleLoadMore = async () => {
    if (!fetchUrl || loading.value) return;

    loading.value = true;
    try {
      const url = new URL(fetchUrl, globalThis.location.origin);
      url.searchParams.set("skip", items.value.length.toString());
      url.searchParams.set("limit", pageSize.toString());
      if (fetchParams) {
        for (const [k, v] of Object.entries(fetchParams)) {
          if (v) url.searchParams.set(k, v);
        }
      }

      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        const newItems = Array.isArray(data) ? data : data.items || [];
        items.value = [...items.value, ...newItems];
      }
    } catch (error) {
      console.error("Failed to load more items:", error);
    } finally {
      loading.value = false;
    }
  };

  if (items.value.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  // Polaris Track H — mobile-card render mode. When the caller opts in via
  // `renderMobileCard` AND the viewport is `<md`, render the items as a
  // stacked card list. Otherwise the existing table path runs unchanged.
  const useCardMode = renderMobileCard !== undefined && isMobile;

  return (
    <div className={cn("space-y-4", className)}>
      {useCardMode
        ? (
          <div className="space-y-2">
            {items.value.map((item, index) => (
              <div
                key={getItemKey(item)}
                onClick={() => onRowClick?.(item, index)}
                className={rowClassName?.(item, index)}
              >
                {renderMobileCard!(item, index)}
              </div>
            ))}
          </div>
        )
        : (
          <Table>
            {!hideHeader && (
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={cn(
                        col.className,
                        col.hideOnMobile && "hidden md:table-cell",
                      )}
                    >
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
            )}
            <TableBody>
              {items.value.map((item, index) => (
                <TableRow
                  key={getItemKey(item)}
                  className={cn(
                    onRowClick && "cursor-pointer hover:bg-muted/50",
                    rowClassName?.(item, index),
                  )}
                  onClick={() => onRowClick?.(item, index)}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        col.className,
                        col.hideOnMobile && "hidden md:table-cell",
                      )}
                    >
                      {col.render(item, index)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

      {/* Footer with count and Load More */}
      <div className="flex items-center justify-between px-4">
        {!hideFooterText
          ? (
            <p className="text-sm text-muted-foreground">
              Showing {items.value.length}
              {totalCount !== undefined && ` of ${totalCount}`} items
            </p>
          )
          : <div />}

        {showLoadMore && hasMore.value && fetchUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loading.value}
            className="gap-2"
          >
            {loading.value
              ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Loading...
                </>
              )
              : (
                <>
                  <ChevronDown className="size-4" />
                  Load More
                </>
              )}
          </Button>
        )}
      </div>
    </div>
  );
}
