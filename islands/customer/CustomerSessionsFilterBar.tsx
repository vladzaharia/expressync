/**
 * Polaris Track G2 — URL-backed filter bar for the customer Sessions list.
 *
 * Mirrors the admin `ChargingSessionsFilters.tsx` pattern: signals hold local
 * state, "Apply" reconstructs the query string and full-page navigates so
 * the loader re-runs and the table reflects the new filter set. We avoid
 * AJAX rehydration so browser back/forward + URL sharing keep working — per
 * the canonical Wave B2/C3 pattern called out in the plan.
 *
 * Visible filters (per plan):
 *   - status (active / completed / failed [reserved])
 *   - date from / to (HTML5 native pickers)
 *
 * Mobile mode collapses each control to its own row; desktop keeps the
 * single-row "flex flex-wrap items-end" layout from admin so the apply/clear
 * buttons stay tail-aligned.
 */

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

export type CustomerSessionStatus = "all" | "active" | "completed" | "failed";

interface Props {
  initialStatus?: CustomerSessionStatus;
  initialFrom?: string;
  initialTo?: string;
}

export default function CustomerSessionsFilterBar({
  initialStatus = "all",
  initialFrom = "",
  initialTo = "",
}: Props) {
  const status = useSignal<CustomerSessionStatus>(initialStatus);
  const from = useSignal(initialFrom);
  const to = useSignal(initialTo);

  const apply = () => {
    const params = new URLSearchParams();
    if (status.value && status.value !== "all") {
      params.set("status", status.value);
    }
    if (from.value) params.set("from", from.value);
    if (to.value) params.set("to", to.value);
    const qs = params.toString();
    globalThis.location.href = qs ? `/sessions?${qs}` : "/sessions";
  };

  const clear = () => {
    globalThis.location.href = "/sessions";
  };

  const hasFilter = status.value !== "all" || from.value || to.value;

  return (
    <div class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 mb-6">
      <div class="min-w-[140px] flex-1 sm:flex-none">
        <Label htmlFor="cs-status" class="text-xs">Status</Label>
        <Select
          value={status.value}
          onValueChange={(v: string) => {
            status.value = v as CustomerSessionStatus;
          }}
        >
          <SelectTrigger id="cs-status" class="mt-1">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="min-w-[140px] flex-1 sm:flex-none">
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

      <div class="min-w-[140px] flex-1 sm:flex-none">
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

      <div class="flex items-center gap-2 ml-auto">
        <Button size="mobile" onClick={apply}>Apply</Button>
        <Button
          variant="outline"
          size="mobile"
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
