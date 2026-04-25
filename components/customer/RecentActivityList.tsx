/**
 * RecentActivityList — day-grouped list of recent sessions for the customer
 * dashboard. Pure server component; each row is an anchor that deep-links
 * to `/sessions/{steveTransactionId}`.
 *
 * Row layout:
 *   [form-factor icon] Charger name        [status]
 *                      Relative time · duration
 *                                       kWh · cost
 *
 * Sessions are grouped by local-date header ("Today", "Yesterday",
 * "Mon 12 Aug"). Grouping matches the user's viewing timezone since the
 * formatter uses `toLocaleDateString`.
 */

import type { FormFactor } from "@/src/lib/types/steve.ts";
import { chargerFormFactorIcons } from "@/components/brand/chargers/index.ts";
import { TransactionStatusBadge } from "@/components/shared/TransactionStatusBadge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface RecentActivityItem {
  id: number;
  steveTransactionId: number;
  syncedAt: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  kwhDelta: number;
  isFinalized: boolean;
  costString?: string | null;
  chargeBoxId?: string | null;
  chargerName?: string | null;
  formFactor?: FormFactor | null;
  durationMinutes?: number | null;
}

interface Props {
  items: RecentActivityItem[];
  className?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso && !endIso) return "—";
  if (!startIso && endIso) return formatTime(endIso);
  if (startIso && !endIso) return formatTime(startIso);
  const start = new Date(startIso!);
  const end = new Date(endIso!);
  const startFmt = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const endFmt = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  // Collapse "2:34 PM – 3:41 PM" → "2:34 – 3:41 PM" when meridiems match.
  const startParts = startFmt.split(" ");
  const endParts = endFmt.split(" ");
  if (
    startParts.length === 2 && endParts.length === 2 &&
    startParts[1] === endParts[1]
  ) {
    return `${startParts[0]} – ${endFmt}`;
  }
  return `${startFmt} – ${endFmt}`;
}

function dayBucket(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDuration(mins: number | null | undefined): string | null {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return null;
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function RecentActivityList({ items, className }: Props) {
  // Group preserving order (list already sorted desc by syncedAt).
  const groups: { key: string; items: RecentActivityItem[] }[] = [];
  for (const it of items) {
    const key = dayBucket(it.syncedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(it);
    } else {
      groups.push({ key, items: [it] });
    }
  }

  return (
    <div class={cn("flex flex-col gap-3", className)}>
      {groups.map((g) => (
        <section key={g.key} class="flex flex-col gap-1.5">
          <p class="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {g.key}
          </p>
          <ul class="flex flex-col gap-1.5">
            {g.items.map((s) => <Row key={s.id} session={s} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ session }: { session: RecentActivityItem }) {
  const factor = (session.formFactor ?? "generic") as FormFactor;
  const Icon = chargerFormFactorIcons[factor] ??
    chargerFormFactorIcons.generic;
  const friendly = session.chargerName?.trim() ?? "";
  const chargerLabel = friendly || session.chargeBoxId || "Unknown charger";
  const showChargeBoxIdChip = friendly.length > 0 && !!session.chargeBoxId &&
    friendly !== session.chargeBoxId;
  const duration = formatDuration(session.durationMinutes);

  return (
    <li>
      <a
        href={`/sessions/${session.steveTransactionId}`}
        class={cn(
          "group flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm",
          "transition-colors hover:border-primary/30 hover:bg-accent/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground group-hover:bg-muted">
          <Icon class="size-5" />
        </span>
        <div class="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium text-foreground">
              {chargerLabel}
              {showChargeBoxIdChip
                ? (
                  <span class="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {session.chargeBoxId}
                  </span>
                )
                : null}
            </p>
            <p class="truncate text-xs text-muted-foreground">
              {formatTimeRange(
                session.startedAt ?? null,
                session.endedAt ?? session.syncedAt ?? null,
              )}
              {duration ? ` · ${duration}` : ""}
            </p>
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <TransactionStatusBadge
              status={session.isFinalized ? "completed" : "in_progress"}
            />
            <p class="text-xs tabular-nums text-muted-foreground">
              <span class="font-semibold text-foreground">
                {session.kwhDelta.toFixed(1)}
              </span>{" "}
              kWh
              {session.costString
                ? (
                  <>
                    <span class="mx-1">·</span>
                    <span>{session.costString}</span>
                  </>
                )
                : null}
            </p>
          </div>
        </div>
      </a>
    </li>
  );
}
