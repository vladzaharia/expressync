/**
 * SyncRunsFilters — URL-backed filter bar for `/sync`.
 *
 * Mirrors the pattern used by `islands/invoices/InvoiceFilters.tsx`: controls
 * are local signals, and "Apply" rebuilds the query string and reloads the
 * page so the loader re-runs with the new filter set.
 */

import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";

type StatusFilter = "" | "completed" | "failed" | "running";
type SegmentFilter = "" | "tag_linking" | "transaction_sync" | "scheduling";

interface Props {
  initial: {
    status: StatusFilter;
    from: string;
    to: string;
    segment: SegmentFilter;
  };
}

export default function SyncRunsFilters({ initial }: Props) {
  const status = useSignal<StatusFilter>(initial.status);
  const from = useSignal(initial.from);
  const to = useSignal(initial.to);
  const segment = useSignal<SegmentFilter>(initial.segment);

  const apply = () => {
    const params = new URLSearchParams();
    if (status.value) params.set("status", status.value);
    if (from.value) params.set("from", from.value);
    if (to.value) params.set("to", to.value);
    if (segment.value) params.set("segment", segment.value);
    const qs = params.toString();
    clientNavigate(qs ? `/sync?${qs}` : "/sync");
  };

  const reset = () => {
    clientNavigate("/sync");
  };

  const hasAny = !!(status.value || from.value || to.value || segment.value);

  return (
    <div class="flex flex-col gap-3 rounded-lg border bg-card p-4 mb-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor="sync-status" class="text-xs">Status</Label>
          <select
            id="sync-status"
            value={status.value}
            onChange={(e) => {
              status.value = (e.currentTarget as HTMLSelectElement)
                .value as StatusFilter;
            }}
            class="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>

        <div>
          <Label htmlFor="sync-segment" class="text-xs">Segment issue</Label>
          <select
            id="sync-segment"
            value={segment.value}
            onChange={(e) => {
              segment.value = (e.currentTarget as HTMLSelectElement)
                .value as SegmentFilter;
            }}
            class="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Any segment</option>
            <option value="tag_linking">Tag Linking (non-success)</option>
            <option value="transaction_sync">
              Transaction Sync (non-success)
            </option>
            <option value="scheduling">Scheduling (errors/warnings)</option>
          </select>
        </div>

        <div>
          <Label htmlFor="sync-from" class="text-xs">From</Label>
          <Input
            id="sync-from"
            type="date"
            value={from.value}
            onInput={(e) => {
              from.value = (e.currentTarget as HTMLInputElement).value;
            }}
            class="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="sync-to" class="text-xs">To</Label>
          <Input
            id="sync-to"
            type="date"
            value={to.value}
            onInput={(e) => {
              to.value = (e.currentTarget as HTMLInputElement).value;
            }}
            class="mt-1"
          />
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={!hasAny}
        >
          Reset
        </Button>
        <Button size="sm" onClick={apply}>Apply filters</Button>
      </div>
    </div>
  );
}
