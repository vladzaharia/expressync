import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { X } from "lucide-preact";

export type ChargingSessionStatus = "all" | "active" | "completed";

interface Props {
  initialStatus?: ChargingSessionStatus;
  initialFrom?: string;
  initialTo?: string;
  initialTag?: string;
}

/**
 * Persistent URL-backed filter bar for the Charging Sessions list page.
 *
 * On apply/clear we rebuild the URL query string and reload the page so the
 * loader re-runs and the table reflects the new filter set. This avoids
 * coordinating with the TransactionsTable island.
 */
export default function ChargingSessionsFilters({
  initialStatus = "all",
  initialFrom = "",
  initialTo = "",
  initialTag = "",
}: Props) {
  const status = useSignal<ChargingSessionStatus>(initialStatus);
  const from = useSignal(initialFrom);
  const to = useSignal(initialTo);
  const tag = useSignal(initialTag);

  const apply = () => {
    const params = new URLSearchParams();
    if (status.value && status.value !== "all") {
      params.set("status", status.value);
    }
    if (from.value) params.set("from", from.value);
    if (to.value) params.set("to", to.value);
    if (tag.value) params.set("tag", tag.value);
    const qs = params.toString();
    globalThis.location.href = qs ? `/transactions?${qs}` : "/transactions";
  };

  const clear = () => {
    globalThis.location.href = "/transactions";
  };

  const hasFilter = status.value !== "all" || from.value || to.value ||
    tag.value;

  return (
    <div class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 mb-6">
      <div class="min-w-[140px]">
        <Label htmlFor="cs-status" class="text-xs">Status</Label>
        <Select
          value={status.value}
          onValueChange={(v: string) => {
            status.value = v as ChargingSessionStatus;
          }}
        >
          <SelectTrigger id="cs-status" class="mt-1">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="min-w-[140px]">
        <Label htmlFor="cs-from" class="text-xs">From</Label>
        <Input
          id="cs-from"
          type="date"
          value={from.value}
          onInput={(e) => {
            from.value = (e.currentTarget as HTMLInputElement).value;
          }}
          class="mt-1"
        />
      </div>

      <div class="min-w-[140px]">
        <Label htmlFor="cs-to" class="text-xs">To</Label>
        <Input
          id="cs-to"
          type="date"
          value={to.value}
          onInput={(e) => {
            to.value = (e.currentTarget as HTMLInputElement).value;
          }}
          class="mt-1"
        />
      </div>

      <div class="flex-1 min-w-[180px]">
        <Label htmlFor="cs-tag" class="text-xs">OCPP tag</Label>
        <Input
          id="cs-tag"
          placeholder="Tag contains…"
          value={tag.value}
          onInput={(e) => {
            tag.value = (e.currentTarget as HTMLInputElement).value;
          }}
          class="mt-1"
        />
      </div>

      <div class="flex items-center gap-2">
        <Button size="sm" onClick={apply}>Apply</Button>
        <Button
          variant="outline"
          size="sm"
          onClick={clear}
          disabled={!hasFilter}
        >
          <X class="size-3.5 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}
