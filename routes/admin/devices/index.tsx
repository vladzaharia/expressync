/**
 * /admin/devices — admin Devices listing.
 *
 * Phones-only in v1 (chargers stay on /admin/chargers). The page server-side
 * queries `tappable_devices` filtered to non-charger kinds and renders a
 * table — phones don't earn a card grid yet (low row count, denser data).
 *
 * Layout per `expresscan/docs/plan/40-frontend.md` § Phase 2:
 *
 *   SidebarLayout accentColor="teal"
 *     PageCard title="Devices" colorScheme="teal"
 *       DevicesStatStrip          (5 cells)
 *       DeviceFiltersBar          (kind / online / owner)
 *       Table                     (label · model · owner · last seen · actions)
 *       Pagination                (Load more via PaginatedTable's fetch)
 *
 * Loader strategy:
 *   - Wrap the same DB query the `/api/admin/devices` endpoint uses, scoped
 *     to phone kinds. We bypass the JSON endpoint and hit the DB directly so
 *     the page renders synchronously without a same-host fetch round-trip.
 *   - Errors are caught at the top level — a degraded page renders an
 *     amber-bannered skeleton rather than a 500.
 *   - Counts (`total`, `online`, `offline`, `phones`) are computed from the
 *     same fetched rows so the strip never disagrees with the table; the
 *     `chargers` count comes from `chargers_cache` (matches the page that
 *     surface lives on).
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { chargersCache } from "../../../src/db/schema.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
  type DeviceSummary,
} from "../../../src/lib/types/devices.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { DevicesStatStrip } from "../../../components/devices/DevicesStatStrip.tsx";
import {
  DeviceFiltersBar,
  type DeviceKindFilter,
  type DeviceOnlineFilter,
} from "../../../components/devices/DeviceFiltersBar.tsx";
import { CapabilityPill } from "../../../components/devices/CapabilityPill.tsx";
import DeviceActionsMenu from "../../../islands/devices/DeviceActionsMenu.tsx";
import { formatRelative } from "../../../islands/shared/device-visuals.ts";

const log = logger.child("AdminDevicesPage");

const PHONE_ONLINE_WINDOW_MS = 90 * 1000;
const DEFAULT_LIMIT = 50;

type ViewRow = {
  id: string;
  kind: string;
  label: string;
  capabilities: string[];
  owner_user_id: string | null;
  registered_at: string | Date;
  last_seen_at: string | Date | null;
  platform: string | null;
  model: string | null;
  app_version: string | null;
  [key: string]: unknown;
};

interface DevicesPageData {
  devices: DeviceSummary[];
  totals: {
    total: number;
    online: number;
    offline: number;
    phones: number;
    chargers: number;
  };
  filters: {
    kind: DeviceKindFilter;
    online: DeviceOnlineFilter;
    owner: string;
  };
  errored: boolean;
}

function toMs(v: string | Date | null): number | null {
  if (v === null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(v: string | Date | null): string | null {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  const n = Date.parse(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function isOnlinePhone(lastSeenMs: number | null): boolean {
  if (lastSeenMs === null) return false;
  return (Date.now() - lastSeenMs) <= PHONE_ONLINE_WINDOW_MS;
}

function coerceKindFilter(raw: string | null): DeviceKindFilter {
  if (raw === "phone_nfc" || raw === "laptop_nfc") return raw;
  return "all";
}

function coerceOnlineFilter(raw: string | null): DeviceOnlineFilter {
  if (raw === "online" || raw === "offline") return raw;
  return "any";
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      // The middleware already enforces admin on /admin/* — defensive 403.
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(ctx.req.url);
    const filters = {
      kind: coerceKindFilter(url.searchParams.get("kind")),
      online: coerceOnlineFilter(url.searchParams.get("online")),
      owner: (url.searchParams.get("owner") ?? "").trim(),
    };

    let devices: DeviceSummary[] = [];
    let chargersCount = 0;
    let errored = false;

    try {
      // Phones-only in v1: filter to non-charger kinds at the SQL layer. When
      // the user picks a specific kind ("phone_nfc" / "laptop_nfc") we
      // tighten further; otherwise both phone variants come back.
      const kindClause = (() => {
        if (filters.kind === "phone_nfc") {
          return sql`tv.kind = 'phone_nfc'`;
        }
        if (filters.kind === "laptop_nfc") {
          return sql`tv.kind = 'laptop_nfc'`;
        }
        return sql`tv.kind <> 'charger'`;
      })();

      const ownerClause = filters.owner.length > 0
        ? sql`tv.owner_user_id = ${filters.owner}`
        : sql`TRUE`;

      const result = await db.execute<ViewRow>(sql`
        SELECT
          tv.id,
          tv.kind,
          tv.label,
          tv.capabilities,
          tv.owner_user_id,
          tv.registered_at,
          tv.last_seen_at,
          d.platform,
          d.model,
          d.app_version
        FROM tappable_devices tv
        LEFT JOIN devices d ON d.id::text = tv.id
        WHERE ${kindClause} AND ${ownerClause}
        ORDER BY tv.last_seen_at DESC NULLS LAST, tv.registered_at DESC
        LIMIT ${DEFAULT_LIMIT}
      `);

      const rows: ViewRow[] = Array.isArray(result)
        ? (result as unknown as ViewRow[])
        : ((result as { rows?: ViewRow[] }).rows ?? []);

      devices = rows
        .map((row): DeviceSummary => {
          const lastMs = toMs(row.last_seen_at);
          return {
            deviceId: row.id,
            kind: row.kind as DeviceSummary["kind"],
            label: row.label,
            capabilities: (row.capabilities ?? []).filter(
              (c): c is DeviceCapability =>
                (DEVICE_CAPABILITIES as readonly string[]).includes(c),
            ),
            ownerUserId: row.owner_user_id,
            platform: row.platform,
            model: row.model,
            appVersion: row.app_version,
            lastSeenAtIso: toIso(row.last_seen_at),
            isOnline: isOnlinePhone(lastMs),
            registeredAtIso: toIso(row.registered_at) ??
              new Date(0).toISOString(),
          };
        })
        .filter((d) => {
          if (filters.online === "online") return d.isOnline;
          if (filters.online === "offline") return !d.isOnline;
          return true;
        });
    } catch (error) {
      errored = true;
      log.error("Failed to load devices listing", error as Error);
    }

    try {
      const [{ c }] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(chargersCache);
      chargersCount = Number(c) || 0;
    } catch (error) {
      log.warn("Failed to count chargers for stat strip", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const totals = {
      total: devices.length + chargersCount,
      online: devices.filter((d) => d.isOnline).length,
      offline: devices.filter((d) => !d.isOnline).length,
      phones: devices.filter((d) => d.kind === "phone_nfc").length,
      chargers: chargersCount,
    };

    return {
      data: {
        devices,
        totals,
        filters,
        errored,
      } satisfies DevicesPageData,
    };
  },
});

function DevicesTableSkeleton() {
  return (
    <div class="rounded-md border">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th class="px-3 py-2 font-medium">Label</th>
            <th class="px-3 py-2 font-medium">Model</th>
            <th class="px-3 py-2 font-medium">Owner</th>
            <th class="px-3 py-2 font-medium">Last seen</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2].map((i) => (
            <tr key={i} class="border-b">
              <td colSpan={6} class="px-3 py-3">
                <div class="h-6 w-full animate-pulse rounded bg-muted/40" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineFetchError() {
  return (
    <div class="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      Couldn't reach the devices view — showing none.
    </div>
  );
}

function DevicesEmptyState() {
  return (
    <div class="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card px-6 py-12 text-center">
      <p class="text-base font-medium">No tappable devices registered yet.</p>
      <p class="max-w-prose text-sm text-muted-foreground">
        Chargers appear under{" "}
        <a href="/admin/chargers" class="underline-offset-4 hover:underline">
          Chargers
        </a>
        . Phones appear after a user installs the app and completes setup.
      </p>
    </div>
  );
}

function DevicesTable(
  { devices, isAdmin }: { devices: DeviceSummary[]; isAdmin: boolean },
) {
  return (
    <div class="overflow-hidden rounded-md border">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th class="px-3 py-2 font-medium">Label</th>
            <th class="px-3 py-2 font-medium">Model</th>
            <th class="px-3 py-2 font-medium">Owner</th>
            <th class="px-3 py-2 font-medium">Last seen</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="w-10 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr
              key={d.deviceId}
              class="border-b transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-3 align-middle">
                <a
                  href={`/admin/devices/${d.deviceId}`}
                  class="flex flex-col hover:underline"
                >
                  <span class="font-medium">{d.label}</span>
                  <span class="font-mono text-xs text-muted-foreground">
                    {d.deviceId.slice(0, 8)}…
                  </span>
                </a>
                {d.capabilities.length > 0 && (
                  <div class="mt-1 flex flex-wrap gap-1">
                    {d.capabilities.map((c) => (
                      <CapabilityPill key={c} capability={c} />
                    ))}
                  </div>
                )}
              </td>
              <td class="px-3 py-3 align-middle">
                <span>{d.model ?? d.platform ?? "—"}</span>
                {d.appVersion && (
                  <span class="ml-1 text-xs text-muted-foreground">
                    v{d.appVersion}
                  </span>
                )}
              </td>
              <td class="px-3 py-3 align-middle">
                {d.ownerUserId
                  ? (
                    <a
                      href={`/admin/users/${d.ownerUserId}`}
                      class="font-mono text-xs hover:underline"
                      title={d.ownerUserId}
                    >
                      {d.ownerUserId.slice(0, 8)}…
                    </a>
                  )
                  : <span class="text-muted-foreground">—</span>}
              </td>
              <td class="px-3 py-3 align-middle text-muted-foreground">
                {formatRelative(d.lastSeenAtIso)}
              </td>
              <td class="px-3 py-3 align-middle">
                <span
                  class={d.isOnline
                    ? "inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-teal-700 dark:text-teal-300"
                    : "inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300"}
                >
                  {d.isOnline ? "Online" : "Offline"}
                </span>
              </td>
              <td class="px-3 py-3 text-right">
                {isAdmin && (
                  <DeviceActionsMenu
                    deviceId={d.deviceId}
                    label={d.label}
                    kind={d.kind}
                    compact
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default define.page<typeof handler>(
  function AdminDevicesPage({ data, url, state }) {
    const isAdmin = state.user?.role === "admin";

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="teal"
      >
        <PageCard title="Devices" colorScheme="teal">
          <div class="mb-6">
            <DevicesStatStrip totals={data.totals} />
          </div>

          <DeviceFiltersBar
            initial={data.filters}
            totalCount={data.devices.length}
          />

          {data.errored
            ? (
              <>
                <DevicesTableSkeleton />
                <InlineFetchError />
              </>
            )
            : data.devices.length === 0
            ? <DevicesEmptyState />
            : <DevicesTable devices={data.devices} isAdmin={isAdmin} />}
        </PageCard>
      </SidebarLayout>
    );
  },
);
