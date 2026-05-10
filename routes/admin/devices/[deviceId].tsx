/**
 * /admin/devices/[deviceId] — admin device detail.
 *
 * Routes both UUID phone/laptop IDs and (for safety) charger
 * `chargeBoxId`s. If the resolved row's `kind === 'charger'`, the handler
 * issues a 307 to `/admin/chargers/{chargeBoxId}` so we keep the two
 * surfaces semantically separate (chargers have a much richer detail page
 * managed elsewhere).
 *
 * Layout per `expresscan/docs/plan/40-frontend.md` § Phase 2:
 *
 *   SidebarLayout accentColor="teal"
 *     PageCard
 *       headerActions: Trigger scan (stub) · Deregister
 *       DeviceIdentityCard   — model, OS, app version, owner, last seen,
 *                              push-token presence, registered date,
 *                              capabilities (already covered there).
 *       SectionCard "Recent Scans" — empty placeholder until we ship a
 *                                    `device_scan_audit` table
 *
 * Loader strategy:
 *   1. First probe the `tappable_devices` view by id. Charger? → 307.
 *   2. Otherwise pull the full `devices` row (joined with `users` for the
 *      owner email) so the identity card has every field it needs.
 *   3. Token rollup: count + most-recent-active expiry. Mirrors the same
 *      logic in `routes/api/admin/devices/[deviceId].ts`.
 *
 * Non-existent id → renders a "not found" state inside the PageCard.
 */

import { eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { devices, deviceTokens, users } from "../../../src/db/schema.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { Activity } from "lucide-preact";
import { DeviceIdentityCard } from "../../../components/devices/DeviceIdentityCard.tsx";
import { DeviceHeaderStrip } from "../../../components/devices/DeviceHeaderStrip.tsx";
import DeviceActionsMenu from "../../../islands/devices/DeviceActionsMenu.tsx";
import TriggerScanButton from "../../../islands/devices/TriggerScanButton.tsx";
import { DeviceLiveStatusCard } from "../../../components/devices/DeviceLiveStatusCard.tsx";
import type { DeviceLiveStatus } from "../../../components/devices/DeviceLiveStatusCard.tsx";
import { DeviceStateSyncList } from "../../../components/devices/DeviceStateSyncList.tsx";
import type { DeviceSyncEntry } from "../../../components/devices/DeviceStateSyncList.tsx";
import AppConfigurationForm from "../../../islands/devices/AppConfigurationForm.tsx";
import DeviceLogsCard from "../../../islands/admin/DeviceLogsCard.tsx";
import {
  ClipboardList,
  History as HistoryIcon,
  Settings2,
} from "lucide-preact";
import { deviceSettings as deviceSettingsTable } from "../../../src/db/schema.ts";
import { pickerOptionsForKind } from "../../../src/lib/devices/capability-metadata.ts";
import type { DeviceCapability } from "../../../src/lib/types/devices.ts";

const log = logger.child("AdminDeviceDetailPage");

interface DeviceDetail {
  deviceId: string;
  kind: "phone_nfc" | "laptop_nfc";
  label: string;
  platform: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  capabilities: string[];
  pushTokenLast8: string | null;
  apnsEnvironment: string | null;
  lastSeenAtIso: string | null;
  registeredAtIso: string;
  deletedAtIso: string | null;
  revokedAtIso: string | null;
  tokenCount: number;
  activeTokenExpiresAtIso: string | null;
  // Wave 6 / Slice D additions for the App Configuration tab.
  lastStatus: Record<string, unknown> | null;
  appConfigSettings: Record<
    string,
    { value: unknown; updatedAtIso: string; updatedBy: string }
  >;
  pickerEditable: DeviceCapability[];
  pickerReadOnly: DeviceCapability[];
}

interface DeviceDetailPageData {
  device: DeviceDetail | null;
}

function maskPushToken(token: string | null): string | null {
  if (token === null || token.length === 0) return null;
  return token.slice(-8);
}

function isoOrNull(v: Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }

    const deviceId = ctx.params.deviceId;
    if (!deviceId || deviceId.length < 1 || deviceId.length > 64) {
      return { data: { device: null } satisfies DeviceDetailPageData };
    }

    // Probe the tappable_devices view by id. The view exposes both phones
    // (UUID) and chargers (chargeBoxId) under the same column. A charger
    // hit redirects to the chargers admin surface.
    try {
      const viewProbe = await db.execute<{ kind: string }>(sql`
        SELECT kind
        FROM tappable_devices
        WHERE id = ${deviceId}
        LIMIT 1
      `);
      const probeRows = Array.isArray(viewProbe)
        ? (viewProbe as unknown as { kind: string }[])
        : ((viewProbe as { rows?: { kind: string }[] }).rows ?? []);
      if (probeRows[0]?.kind === "charger") {
        return new Response(null, {
          status: 307,
          headers: {
            Location: `/admin/chargers/${encodeURIComponent(deviceId)}`,
          },
        });
      }
    } catch (error) {
      log.warn("View probe failed; continuing with device lookup", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Phone/laptop detail — full devices row + owner email + token rollup.
    // UUIDs are 36 chars, but we don't enforce strictly here so legacy ids
    // (test fixtures, future kinds) still resolve cleanly.
    let detail: DeviceDetail | null = null;
    try {
      const [row] = await db
        .select({
          id: devices.id,
          kind: devices.kind,
          label: devices.label,
          capabilities: devices.capabilities,
          ownerUserId: devices.ownerUserId,
          ownerEmail: users.email,
          platform: devices.platform,
          model: devices.model,
          osVersion: devices.osVersion,
          appVersion: devices.appVersion,
          pushToken: devices.pushToken,
          apnsEnvironment: devices.apnsEnvironment,
          lastSeenAt: devices.lastSeenAt,
          lastStatus: devices.lastStatus,
          registeredAt: devices.registeredAt,
          deletedAt: devices.deletedAt,
          revokedAt: devices.revokedAt,
        })
        .from(devices)
        .leftJoin(users, eq(users.id, devices.ownerUserId))
        .where(eq(devices.id, deviceId))
        .limit(1);

      if (row) {
        const tokenRows = await db
          .select({
            id: deviceTokens.id,
            expiresAt: deviceTokens.expiresAt,
            revokedAt: deviceTokens.revokedAt,
            createdAt: deviceTokens.createdAt,
          })
          .from(deviceTokens)
          .where(eq(deviceTokens.deviceId, row.id))
          .orderBy(sql`${deviceTokens.createdAt} DESC`);

        const tokenCount = tokenRows.length;
        const activeToken = tokenRows.find((t) => t.revokedAt === null);

        const settingsRows = await db
          .select({
            key: deviceSettingsTable.key,
            valueJson: deviceSettingsTable.valueJson,
            updatedAt: deviceSettingsTable.updatedAt,
            updatedBy: deviceSettingsTable.updatedBy,
          })
          .from(deviceSettingsTable)
          .where(eq(deviceSettingsTable.deviceId, row.id));

        const appConfigSettings: Record<
          string,
          { value: unknown; updatedAtIso: string; updatedBy: string }
        > = {};
        for (const sRow of settingsRows) {
          appConfigSettings[sRow.key] = {
            value: sRow.valueJson,
            updatedAtIso: isoOrNull(sRow.updatedAt) ??
              new Date(0).toISOString(),
            updatedBy: sRow.updatedBy,
          };
        }

        const pickerOpts = pickerOptionsForKind(row.kind);

        detail = {
          deviceId: row.id,
          kind: (row.kind === "phone_nfc" || row.kind === "laptop_nfc")
            ? row.kind
            : "phone_nfc",
          label: row.label,
          platform: row.platform,
          model: row.model,
          osVersion: row.osVersion,
          appVersion: row.appVersion,
          ownerUserId: row.ownerUserId,
          ownerEmail: row.ownerEmail ?? null,
          capabilities: row.capabilities ?? [],
          pushTokenLast8: maskPushToken(row.pushToken),
          apnsEnvironment: row.apnsEnvironment,
          lastSeenAtIso: isoOrNull(row.lastSeenAt),
          registeredAtIso: isoOrNull(row.registeredAt) ??
            new Date(0).toISOString(),
          deletedAtIso: isoOrNull(row.deletedAt),
          revokedAtIso: isoOrNull(row.revokedAt),
          tokenCount,
          activeTokenExpiresAtIso: isoOrNull(activeToken?.expiresAt ?? null),
          lastStatus: (row.lastStatus ?? null) as
            | Record<string, unknown>
            | null,
          appConfigSettings,
          pickerEditable: [...pickerOpts.editable] as DeviceCapability[],
          pickerReadOnly: [...pickerOpts.readOnly] as DeviceCapability[],
        };
      }
    } catch (error) {
      log.error("Failed to load device detail", error as Error);
    }

    return { data: { device: detail } satisfies DeviceDetailPageData };
  },
});

function NotFoundBody() {
  return (
    <div class="py-8 text-center text-muted-foreground">
      That device isn't registered, or it has been deregistered.{" "}
      <a
        href="/admin/devices"
        class="text-primary underline-offset-4 hover:underline"
      >
        Back to devices
      </a>
    </div>
  );
}

function RecentScansEmpty() {
  return (
    <div class="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
      <Activity aria-hidden class="size-8 opacity-40" />
      <p class="text-sm font-medium">No recent scans</p>
      <p class="text-xs">
        Scan history will appear here once a tap pairing completes.
      </p>
    </div>
  );
}

export default define.page<typeof handler>(
  function AdminDeviceDetailPage({ data, url, state }) {
    const device = data.device;

    if (!device) {
      return (
        <SidebarLayout
          currentPath={url.pathname}
          user={state.user}
          accentColor="teal"
        >
          <PageCard title="Device not found" colorScheme="teal">
            <NotFoundBody />
          </PageCard>
        </SidebarLayout>
      );
    }

    const isDeregistered = device.deletedAtIso !== null;

    // Heartbeat freshness — same 90s window as the listing page's
    // online filter. Derived once at the top of the render so the
    // header-actions slot AND the in-page header strip / identity
    // card all agree on liveness.
    let isOnline = false;
    if (device.lastSeenAtIso) {
      const ms = Date.parse(device.lastSeenAtIso);
      if (Number.isFinite(ms)) {
        isOnline = Date.now() - ms <= 90 * 1000;
      }
    }

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="teal"
      >
        <PageCard
          title={device.label}
          description={isDeregistered
            ? `Deregistered ${device.deletedAtIso}`
            : `${
              device.kind === "phone_nfc" ? "Phone" : "Laptop"
            } · ${device.tokenCount} token${
              device.tokenCount === 1 ? "" : "s"
            }`}
          colorScheme="teal"
          headerActions={
            <div class="flex items-center gap-2">
              {!isDeregistered && (
                <TriggerScanButton
                  deviceId={device.deviceId}
                  label={device.label}
                  isOnline={isOnline}
                />
              )}
              {!isDeregistered && (
                <DeviceActionsMenu
                  deviceId={device.deviceId}
                  label={device.label}
                  kind={device.kind}
                />
              )}
            </div>
          }
        >
          {(() => {
            // Visual layout mirrors `/admin/chargers/:id`: HeaderStrip →
            // 1+2 grid (identity + live-status hero) → App Configuration →
            // 1+1 grid (recent syncs + recent scans). The hero card is
            // the analogue of `ChargerLiveStatusCard` — big status pill,
            // last-sync timestamp, permission row, and the diagnostic
            // counters that used to live in the (now-folded) Diagnostics
            // card.
            const ls = (device.lastStatus ?? {}) as Record<string, unknown>;
            const num = (k: string): number | null =>
              typeof ls[k] === "number" && Number.isFinite(ls[k] as number)
                ? (ls[k] as number)
                : null;
            const str = (k: string): string | null =>
              typeof ls[k] === "string" ? (ls[k] as string) : null;
            const bool = (k: string): boolean | null =>
              typeof ls[k] === "boolean" ? (ls[k] as boolean) : null;
            const isPushPerm = (
              v: unknown,
            ): v is NonNullable<DeviceLiveStatus["pushPermission"]> =>
              v === "authorized" || v === "denied" ||
              v === "notDetermined" || v === "provisional" ||
              v === "ephemeral";
            const isPermState = (
              v: unknown,
            ): v is NonNullable<DeviceLiveStatus["nfcPermission"]> =>
              v === "authorized" || v === "denied" ||
              v === "notDetermined" || v === "restricted" ||
              v === "unavailable";
            const isBgState = (
              v: unknown,
            ): v is NonNullable<DeviceLiveStatus["backgroundRefreshStatus"]> =>
              v === "available" || v === "denied" || v === "restricted";
            const isBatteryState = (
              v: unknown,
            ): v is NonNullable<DeviceLiveStatus["batteryState"]> =>
              v === "unknown" || v === "unplugged" ||
              v === "charging" || v === "full";
            const isThermalState = (
              v: unknown,
            ): v is NonNullable<DeviceLiveStatus["thermalState"]> =>
              v === "nominal" || v === "fair" ||
              v === "serious" || v === "critical";

            const liveStatus: DeviceLiveStatus = {
              isOnline,
              lastSeenAtIso: device.lastSeenAtIso,
              reconnectCount: Math.max(
                0,
                Math.floor(num("reconnectCount") ?? 0),
              ),
              pendingUploads: Math.max(
                0,
                Math.floor(num("pendingUploads") ?? 0),
              ),
              pushPermission: isPushPerm(ls.pushPermission)
                ? ls.pushPermission
                : null,
              pushTokenLast8: device.pushTokenLast8,
              apnsEnvironment: device.apnsEnvironment ?? str("apnsEnvironment"),
              nfcAvailable: bool("nfcAvailable"),
              nfcPermission: isPermState(ls.nfcPermission)
                ? ls.nfcPermission
                : null,
              backgroundRefreshStatus: isBgState(ls.backgroundRefreshStatus)
                ? ls.backgroundRefreshStatus
                : null,
              appVersion: device.appVersion,
              osVersion: device.osVersion,
              model: device.model,
              localizedModel: str("localizedModel"),
              platform: device.platform ?? str("platform"),
              locale: str("locale"),
              timezone: str("timezone"),
              batteryLevel: num("batteryLevel"),
              batteryState: isBatteryState(ls.batteryState)
                ? ls.batteryState
                : null,
              lowPowerMode: bool("lowPowerMode"),
              thermalState: isThermalState(ls.thermalState)
                ? ls.thermalState
                : null,
              networkInterface: str("networkInterface"),
              networkIsConstrained: bool("networkIsConstrained"),
              networkIsExpensive: bool("networkIsExpensive"),
              diskFreeBytes: num("diskFreeBytes"),
              lastErrorMessage: str("lastErrorMessage"),
            };
            const recentSyncs: DeviceSyncEntry[] = [];

            return (
              <div class="flex flex-col gap-6">
                {/* Header strip — identity + status pills */}
                <DeviceHeaderStrip
                  deviceId={device.deviceId}
                  label={device.label}
                  kind={device.kind}
                  isOnline={isOnline}
                  lastSeenAtIso={device.lastSeenAtIso}
                  capabilities={device.capabilities}
                  ownerEmail={device.ownerEmail}
                  isDeregistered={isDeregistered}
                  isRevoked={device.revokedAtIso !== null}
                />

                {/* Row 1: identity + live status hero, 1+2 split at lg: */}
                <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <DeviceIdentityCard
                    class="lg:col-span-1"
                    deviceId={device.deviceId}
                    kind={device.kind}
                    label={device.label}
                    platform={device.platform}
                    model={device.model}
                    osVersion={device.osVersion}
                    appVersion={device.appVersion}
                    ownerUserId={device.ownerUserId}
                    ownerEmail={device.ownerEmail}
                    capabilities={device.capabilities}
                    isOnline={isOnline}
                    lastSeenAtIso={device.lastSeenAtIso}
                    registeredAtIso={device.registeredAtIso}
                  />
                  <DeviceLiveStatusCard
                    class="lg:col-span-2"
                    status={liveStatus}
                  />
                </div>

                {/* Row 2: App Configuration full-width — single Save covers both halves. */}
                <SectionCard
                  title="App Configuration"
                  description="Capabilities and settings for this app device."
                  icon={Settings2}
                  accent="teal"
                >
                  <AppConfigurationForm
                    deviceId={device.deviceId}
                    kind={device.kind}
                    current={device.capabilities as DeviceCapability[]}
                    settings={device.appConfigSettings}
                    hasApnsToken={device.pushTokenLast8 !== null}
                  />
                </SectionCard>

                {/* Row 3: recent syncs + recent scans, side-by-side at xl: */}
                <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <SectionCard
                    title="Recent syncs"
                    description="Recent device-state syncs from this device."
                    icon={HistoryIcon}
                    accent="teal"
                  >
                    <DeviceStateSyncList recentSyncs={recentSyncs} />
                  </SectionCard>

                  <SectionCard
                    title="Recent Scans"
                    description="Last 50 scan events involving this device."
                    icon={Activity}
                    accent="teal"
                  >
                    <RecentScansEmpty />
                  </SectionCard>

                  <SectionCard
                    title="Device logs"
                    description="OpenTelemetry-shaped log records shipped from this device on every sync. Last 7 days; PII scrubbed on-device before write."
                    icon={ClipboardList}
                    accent="teal"
                  >
                    <DeviceLogsCard deviceId={device.deviceId} />
                  </SectionCard>
                </div>
              </div>
            );
          })()}
        </PageCard>
      </SidebarLayout>
    );
  },
);
