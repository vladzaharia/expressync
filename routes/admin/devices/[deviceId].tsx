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
 *       headerActions: Trigger scan (stub) · Force deregister
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
import { Button } from "../../../components/ui/button.tsx";
import { Activity, ScanLine } from "lucide-preact";
import { DeviceIdentityCard } from "../../../components/devices/DeviceIdentityCard.tsx";
import { DeviceHeaderStrip } from "../../../components/devices/DeviceHeaderStrip.tsx";
import DeviceActionsMenu from "../../../islands/devices/DeviceActionsMenu.tsx";

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
    <div class="flex flex-col items-center gap-1 py-8 text-center">
      <p class="text-sm font-medium">No recent scans</p>
      <p class="text-xs text-muted-foreground">
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
              {
                /*
                TODO(D3): Wire `Trigger scan` to the unified scan modal once
                D3 lands the picker. For v1 this is a stub button; the modal
                + scan-arm dispatch are owned by Track D3.
              */
              }
              <Button
                size="sm"
                variant="outline"
                title="Wired up by Track D3 (scan modal picker swap)."
                disabled
              >
                <ScanLine class="size-4" />
                Trigger scan
              </Button>
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
          <div class="flex flex-col gap-6">
            {(() => {
              // Heartbeat freshness — same 90s window as the listing
              // page's online filter, derived once and shared between
              // the header strip and the identity card so both surfaces
              // agree.
              let isOnline = false;
              if (device.lastSeenAtIso) {
                const ms = Date.parse(device.lastSeenAtIso);
                if (Number.isFinite(ms)) {
                  isOnline = Date.now() - ms <= 90 * 1000;
                }
              }
              return (
                <>
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

                  <DeviceIdentityCard
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
                    pushTokenLast8={device.pushTokenLast8}
                    apnsEnvironment={device.apnsEnvironment}
                    isOnline={isOnline}
                    lastSeenAtIso={device.lastSeenAtIso}
                    registeredAtIso={device.registeredAtIso}
                  />
                </>
              );
            })()}

            <SectionCard
              title="Recent Scans"
              description="Last 50 scan events involving this device."
              icon={Activity}
              accent="teal"
            >
              <RecentScansEmpty />
            </SectionCard>
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
