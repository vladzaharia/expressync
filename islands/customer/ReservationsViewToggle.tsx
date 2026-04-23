/**
 * ReservationsViewToggle — switches between calendar and list views.
 *
 * Polaris Track G3 — small URL-backed two-chip toggle. When the user picks
 * a view, we update the URL `?view=calendar|list` so the loader can pre-set
 * the right wrapper component and view state survives a refresh.
 */

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { CalendarDays, ListOrdered } from "lucide-preact";

export type ReservationsView = "calendar" | "list";

interface Props {
  value: ReservationsView;
  basePath?: string;
}

function buildHref(basePath: string, view: ReservationsView): string {
  if (typeof globalThis.location === "undefined") {
    return `${basePath}?view=${view}`;
  }
  const url = new URL(globalThis.location.href);
  url.pathname = basePath;
  url.searchParams.set("view", view);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export default function ReservationsViewToggle(
  { value, basePath = "/reservations" }: Props,
) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next: string) => {
        if (!next || next === value) return;
        globalThis.location.href = buildHref(
          basePath,
          next as ReservationsView,
        );
      }}
      variant="outline-joined"
      size="sm"
      aria-label="Reservations view"
    >
      <ToggleGroupItem value="calendar" aria-label="Calendar view">
        <CalendarDays className="size-4" aria-hidden="true" />
        <span className="ml-1.5">Calendar</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view">
        <ListOrdered className="size-4" aria-hidden="true" />
        <span className="ml-1.5">List</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
