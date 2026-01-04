import { useSignal, useComputed } from "@preact/signals";
import { Button } from "./button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.tsx";
import { Loader2, ChevronDown } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren, VNode } from "preact";

export interface PaginatedTableColumn<T> {
  key: string;
  header: string;
  className?: string;
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
}

export function PaginatedTable<T>({
  initialItems,
  columns,
  totalCount,
  pageSize = 15,
  fetchUrl,
  showLoadMore = true,
  emptyMessage = "No items found",
  onRowClick,
  getItemKey,
  className,
  rowClassName,
}: PaginatedTableProps<T>) {
  const items = useSignal<T[]>(initialItems);
  const loading = useSignal(false);
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

  return (
    <div className={cn("space-y-4", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className={col.className}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
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
                <TableCell key={col.key} className={col.className}>
                  {col.render(item, index)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Footer with count and Load More */}
      <div className="flex items-center justify-between px-2">
        <p className="text-sm text-muted-foreground">
          Showing {items.value.length}
          {totalCount !== undefined && ` of ${totalCount}`} items
        </p>

        {showLoadMore && hasMore.value && fetchUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loading.value}
            className="gap-2"
          >
            {loading.value ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Loading...
              </>
            ) : (
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

