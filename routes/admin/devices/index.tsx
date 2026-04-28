/**
 * /admin/devices — unified admin Devices listing.
 *
 * Single surface that lists BOTH OCPP chargers (from `chargers_cache`) AND
 * iOS/macOS NFC scanners (from `devices`) in one responsive card grid. The
 * old `/admin/chargers` index route 302-redirects here with `?type=charger`.
 *
 * Layout:
 *   SidebarLayout accentColor="teal"
 *     PageCard title="Devices" colorScheme="teal"
 *       DevicesStatStrip      (Total · Online · Offline · Chargers · Scanners)
 *       DeviceFiltersBar      (type · kind · online · owner)
 *       DeviceCard[]          (responsive 1/2/3-col grid, mixed charger+scanner)
 *
 * Loader strategy: query `chargers_cache` and `devices` independently with
 * the typed Drizzle query builder (avoids the brittle `tappable_devices`
 * view + LEFT JOIN that was failing in production), build a discriminated
 * union DTO, then merge + sort by `lastSeenAt`. Filters apply server-side
 * before the merge so paging stays cheap. Errors per data source are
 * captured separately so a single outage degrades to half the grid + an
 * inline banner rather than a full 500.
 */

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import {
  chargersCache,
  devices as devicesTable,
} from "../../../src/db/schema.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
} from "../../../src/lib/types/devices.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { DevicesStatStrip } from "../../../components/devices/DevicesStatStrip.tsx";
import type {
  DeviceKindFilter,
  DeviceOnlineFilter,
  DeviceTypeFilter,
} from "../../../components/devices/DeviceFiltersBar.tsx";
import DeviceCard, {
  type ChargerCardDto,
  type DeviceCardDto,
  type UnifiedDeviceEntry,
} from "../../../islands/devices/DeviceCard.tsx";
import { normalizeStatus } from "../../../islands/shared/device-visuals.ts";

const log = logger.child("AdminDevicesPage");

/** Heartbeat freshness window for scanners (matches scan-stream / scan-arm). */
const SCANNER_ONLINE_WINDOW_MS = 90 * 1000;
/** Combined query soft cap. */
const ROW_LIMIT = 200;

interface DevicesPageData {
  entries: UnifiedDeviceEntry[];
  totals: {
    total: number;
    online: number;
    offline: number;
    scanners: number;
    chargers: number;
  };
  filters: {
    type: DeviceTypeFilter;
    kind: DeviceKindFilter;
    online: DeviceOnlineFilter;
    owner: string;
  };
  errored: boolean;
}

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const n = Date.parse(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function lastSeenMs(entry: UnifiedDeviceEntry): number {
  const iso = entry.type === "charger"
    ? entry.data.lastSeenAtIso
    : entry.data.lastSeenAtIso;
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function isScannerOnline(lastSeenIso: string | null): boolean {
  if (!lastSeenIso) return false;
  const n = Date.parse(lastSeenIso);
  if (!Number.isFinite(n)) return false;
  return Date.now() - n <= SCANNER_ONLINE_WINDOW_MS;
}

function isChargerOnline(entry: ChargerCardDto): boolean {
  const ui = normalizeStatus(
    entry.lastStatus,
    entry.lastStatusAtIso,
    false,
  );
  return ui !== "Offline";
}

function coerceTypeFilter(raw: string | null): DeviceTypeFilter {
  if (raw === "charger" || raw === "scanner") return raw;
  return "all";
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
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(ctx.req.url);
    const filters = {
      type: coerceTypeFilter(url.searchParams.get("type")),
      kind: coerceKindFilter(url.searchParams.get("kind")),
      online: coerceOnlineFilter(url.searchParams.get("online")),
      owner: (url.searchParams.get("owner") ?? "").trim(),
    };

    let chargerEntries: UnifiedDeviceEntry[] = [];
    let scannerEntries: UnifiedDeviceEntry[] = [];
    let errored = false;

    // ---- Chargers ----
    // Skip the query entirely when the type filter excludes chargers — saves
    // a round-trip for admins who've drilled into the scanner half.
    if (filters.type !== "scanner") {
      try {
        const rows = await db
          .select()
          .from(chargersCache)
          .orderBy(desc(chargersCache.lastSeenAt))
          .limit(ROW_LIMIT);
        chargerEntries = rows.map((r): UnifiedDeviceEntry => ({
          type: "charger",
          data: {
            chargeBoxId: r.chargeBoxId,
            chargeBoxPk: r.chargeBoxPk,
            friendlyName: r.friendlyName,
            formFactor: r.formFactor,
            firstSeenAtIso: (r.firstSeenAt ?? new Date(0)).toISOString(),
            lastSeenAtIso: (r.lastSeenAt ?? new Date(0)).toISOString(),
            lastStatus: r.lastStatus,
            lastStatusAtIso: isoOrNull(r.lastStatusAt),
          } satisfies ChargerCardDto,
        }));
      } catch (error) {
        errored = true;
        log.error("Failed to load chargers_cache", error as Error);
      }
    }

    // ---- Scanners (phones/laptops) ----
    // Soft-deleted devices are hidden. Owner filter is exact-match on the
    // owner_user_id (matches the existing /api/admin/devices contract).
    if (filters.type !== "charger") {
      try {
        const conditions = [isNull(devicesTable.deletedAt)];
        if (filters.kind === "phone_nfc") {
          conditions.push(eq(devicesTable.kind, "phone_nfc"));
        } else if (filters.kind === "laptop_nfc") {
          conditions.push(eq(devicesTable.kind, "laptop_nfc"));
        } else {
          // Any non-charger kind. The check constraint already restricts to
          // the two phone/laptop kinds, but be explicit.
          conditions.push(
            or(
              eq(devicesTable.kind, "phone_nfc"),
              eq(devicesTable.kind, "laptop_nfc"),
            )!,
          );
        }
        if (filters.owner.length > 0) {
          conditions.push(eq(devicesTable.ownerUserId, filters.owner));
        }

        const rows = await db
          .select({
            id: devicesTable.id,
            kind: devicesTable.kind,
            label: devicesTable.label,
            capabilities: devicesTable.capabilities,
            ownerUserId: devicesTable.ownerUserId,
            platform: devicesTable.platform,
            model: devicesTable.model,
            appVersion: devicesTable.appVersion,
            lastSeenAt: devicesTable.lastSeenAt,
            registeredAt: devicesTable.registeredAt,
          })
          .from(devicesTable)
          .where(and(...conditions))
          .orderBy(
            sql`${devicesTable.lastSeenAt} DESC NULLS LAST`,
            desc(devicesTable.registeredAt),
          )
          .limit(ROW_LIMIT);

        scannerEntries = rows.map((r): UnifiedDeviceEntry => {
          const lastSeenIso = isoOrNull(r.lastSeenAt);
          const kind = (r.kind === "phone_nfc" || r.kind === "laptop_nfc")
            ? r.kind
            : "phone_nfc";
          return {
            type: "scanner",
            data: {
              deviceId: r.id,
              kind,
              label: r.label,
              platform: r.platform,
              model: r.model,
              appVersion: r.appVersion,
              ownerUserId: r.ownerUserId,
              capabilities: (r.capabilities ?? []).filter(
                (c): c is DeviceCapability =>
                  (DEVICE_CAPABILITIES as readonly string[]).includes(c),
              ),
              lastSeenAtIso: lastSeenIso,
              isOnline: isScannerOnline(lastSeenIso),
              registeredAtIso: isoOrNull(r.registeredAt) ??
                new Date(0).toISOString(),
            } satisfies DeviceCardDto,
          };
        });
      } catch (error) {
        errored = true;
        log.error("Failed to load devices", error as Error);
      }
    }

    // ---- Online filter (post-merge) ----
    const isOnline = (e: UnifiedDeviceEntry): boolean =>
      e.type === "charger"
        ? isChargerOnline(e.data)
        : isScannerOnline(e.data.lastSeenAtIso);

    let entries = [...chargerEntries, ...scannerEntries];
    if (filters.online === "online") entries = entries.filter(isOnline);
    if (filters.online === "offline") {
      entries = entries.filter((e) => !isOnline(e));
    }

    // Sort merged result by last-seen desc so the freshest devices float to
    // the top regardless of which table they came from.
    entries.sort((a, b) => lastSeenMs(b) - lastSeenMs(a));

    // Totals aggregate the FILTERED entries so the strip and grid agree.
    const totals = {
      total: entries.length,
      online: entries.filter(isOnline).length,
      offline: entries.filter((e) => !isOnline(e)).length,
      scanners: entries.filter((e) => e.type === "scanner").length,
      chargers: entries.filter((e) => e.type === "charger").length,
    };

    return {
      data: {
        entries,
        totals,
        filters,
        errored,
      } satisfies DevicesPageData,
    };
  },
});

function GridSkeleton() {
  return (
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          class="h-44 animate-pulse rounded-xl border bg-muted/40"
        />
      ))}
    </div>
  );
}

function InlineFetchError() {
  return (
    <div class="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      Couldn't reach one of the device sources — showing partial results.
    </div>
  );
}

function DevicesEmptyState({ activeType }: { activeType: DeviceTypeFilter }) {
  const headline = activeType === "charger"
    ? "No chargers cached yet."
    : activeType === "scanner"
    ? "No scanners registered yet."
    : "No devices yet.";
  const body = activeType === "charger"
    ? "Connect a chargepoint via SteVe — it will appear here once it boots and announces itself over OCPP."
    : activeType === "scanner"
    ? "Install the ExpressCharge iOS app and complete the registration flow — the device will appear here after pairing."
    : "Connect a chargepoint via SteVe, or pair a phone using the ExpressCharge iOS app.";
  return (
    <div class="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card px-6 py-12 text-center">
      <p class="text-base font-medium">{headline}</p>
      <p class="max-w-prose text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export default define.page<typeof handler>(
  function AdminDevicesPage({ data, url, state }) {
    const isAdmin = state.user?.role === "admin";
    const count = data.entries.length;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="teal"
      >
        <PageCard title="Devices" colorScheme="teal">
          <div class="mb-6">
            <DevicesStatStrip
              totals={data.totals}
              activeType={data.filters.type}
            />
          </div>

          {data.errored && count === 0
            ? (
              <>
                <GridSkeleton />
                <InlineFetchError />
              </>
            )
            : count === 0
            ? <DevicesEmptyState activeType={data.filters.type} />
            : (
              <>
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {data.entries.map((entry) => (
                    <DeviceCard
                      key={entry.type === "charger"
                        ? `c:${entry.data.chargeBoxId}`
                        : `s:${entry.data.deviceId}`}
                      entry={entry}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
                {data.errored && <InlineFetchError />}
              </>
            )}
        </PageCard>
      </SidebarLayout>
    );
  },
);
