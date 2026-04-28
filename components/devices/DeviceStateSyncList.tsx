/**
 * DeviceStateSyncList — placeholder "Recent syncs" panel on the App
 * Configuration tab.
 *
 * Slice D ships this as a stub: the GET configuration endpoint returns
 * `recentSyncs: []` until the audit-derived view lands in a follow-up.
 * The component renders a `ContentUnavailable`-style empty state when
 * the array is empty so the tab still reads as complete.
 */

import { History } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

export interface DeviceSyncEntry {
  syncedAtIso: string;
  changedKeys: string[];
  actor: string;
}

interface DeviceStateSyncListProps {
  recentSyncs: DeviceSyncEntry[];
  class?: string;
}

function formatAbs(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function DeviceStateSyncList(
  { recentSyncs, class: className }: DeviceStateSyncListProps,
) {
  if (recentSyncs.length === 0) {
    return (
      <div
        class={cn(
          "flex flex-col items-center gap-2 py-8 text-center text-muted-foreground",
          className,
        )}
      >
        <History aria-hidden class="size-8 opacity-40" />
        <p class="text-sm font-medium">No sync history yet</p>
        <p class="text-xs">
          Recent device-state syncs will appear here once the audit view ships.
        </p>
      </div>
    );
  }

  return (
    <ul class={cn("divide-y divide-border", className)}>
      {recentSyncs.map((entry, i) => (
        <li
          key={`${entry.syncedAtIso}-${i}`}
          class="flex flex-col gap-1 py-2 text-sm"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="font-medium">{formatAbs(entry.syncedAtIso)}</span>
            <span class="text-xs text-muted-foreground">{entry.actor}</span>
          </div>
          <span class="text-xs text-muted-foreground">
            Changed: {entry.changedKeys.join(", ") || "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
