/**
 * Charge Box Details page (`/admin/chargers/[chargeBoxId]`).
 *
 * Layout (post 2026-05 redesign — single skeleton for managed and
 * unmanaged):
 *
 *   PageCard
 *     ChargerHeaderStrip          ← pills + heartbeat + Refresh +
 *                                   active-session mini-summary; absorbs
 *                                   the old ChargerLiveStatusCard
 *     ┌─────────────────────────┬──────────────────────────────────┐
 *     │ ChargerIdentityCard     │ Location (SectionCard)           │
 *     │ (1/3 width)             │  Capabilities (SectionCard, below) │
 *     │                         │ (2/3 width, stacked)             │
 *     └─────────────────────────┴──────────────────────────────────┘
 *     ConnectorsSection           ← full-width SectionCard with `+ Add`
 *                                   (managed-only sections below)
 *     ┌────────────┬────────────┐
 *     │ Recent tx  │ Op. audit  │
 *     └────────────┴────────────┘
 *     RemoteActionsPanel
 *
 * Connector source: `charger_connectors` table is the canonical list.
 * Managed chargers also auto-insert a row when StEvE reports a
 * connector we haven't observed yet, so admins can edit spec without
 * needing to manually create the row.
 */

import { desc, eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { steveClient } from "../../../src/lib/steve-client.ts";
import type { StEvETransaction } from "../../../src/lib/types/steve.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  normalizeStatus,
  OFFLINE_AFTER_MS,
  STALE_DIM_MS,
  type UiStatus,
} from "../../../islands/shared/device-visuals.ts";

import { ChargerHeaderStrip } from "../../../components/chargers/ChargerHeaderStrip.tsx";
import PublicIdQrPopover from "../../../islands/shared/PublicIdQrPopover.tsx";
import ChargerLocationEditor from "../../../islands/charger-actions/ChargerLocationEditor.tsx";
import ChargerIdentityCard from "../../../islands/ChargerIdentityCard.tsx";
import ConnectorsSection from "../../../islands/ConnectorsSection.tsx";
import type {
  ConnectorDto,
  ConnectorUiStatus,
} from "../../../islands/ConnectorCard.tsx";
import ChargerRecentTransactionsSection, {
  type ChargerRecentTxRow,
} from "../../../islands/ChargerRecentTransactionsSection.tsx";
import ChargerOperationLogTable, {
  type OperationLogRow,
} from "../../../islands/ChargerOperationLogTable.tsx";
import RemoteActionsPanel from "../../../islands/charger-actions/RemoteActionsPanel.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { ClipboardList, MapPin, Settings2 } from "lucide-preact";
import AppConfigurationForm from "../../../islands/devices/AppConfigurationForm.tsx";
import type { DeviceCapability } from "../../../src/lib/types/devices.ts";
import {
  ensureConnectorExists,
  listConnectors,
} from "../../../src/services/charger-connectors.service.ts";

// ---------------------------------------------------------------------------
// Loader DTO
// ---------------------------------------------------------------------------

interface ActiveSessionCtx {
  transactionId: number;
  connectorId: number;
  startTimestampIso: string;
  idTag: string;
}

interface ChargerDetailLoaderData {
  charger: null | {
    chargeBoxId: string;
    publicId: string;
    friendlyName: string | null;
    formFactor: string;
    addressLine1: string | null;
    addressLine2: string | null;
    addressCity: string | null;
    addressRegion: string | null;
    addressPostalCode: string | null;
    addressCountry: string | null;
    latitude: number | null;
    longitude: number | null;
    firstSeenAtIso: string;
    lastSeenAtIso: string;
    lastStatus: string | null;
    lastStatusAtIso: string | null;

    // Identity — display rule applied at the boundary so islands stay
    // simple. `vendor / model / firmwareVersion` carry the effective
    // value (override ?? steveValue ?? null); the matching `*Override`
    // fields carry the raw override for the smart-text inputs.
    vendor: string | null;
    vendorOverride: string | null;
    model: string | null;
    modelOverride: string | null;
    firmwareVersion: string | null;
    firmwareVersionOverride: string | null;
    registrationStatus: "Accepted" | "Pending" | "Rejected" | null;

    uiStatus: UiStatus;
    isStale: boolean;
    isOffline: boolean;

    capabilities: DeviceCapability[];

    managementMode: "ocpp" | "unmanaged";
    locationDescription: string | null;
  };
  connectors: ConnectorDto[];
  recentTransactions: ChargerRecentTxRow[];
  operationLog: OperationLogRow[];
  activeSessions: ActiveSessionCtx[];
  isAdmin: boolean;
  steveFetchFailed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function txDeliveredKwh(tx: StEvETransaction): number | null {
  const start = Number(tx.startValue);
  const stop = tx.stopValue !== null ? Number(tx.stopValue) : null;
  if (!Number.isFinite(start)) return null;
  if (stop === null || !Number.isFinite(stop)) return null;
  return (stop - start) / 1000;
}

function normalizeConnectorStatus(
  raw: string | null,
  hasActive: boolean,
): ConnectorUiStatus {
  if (hasActive) return "Charging";
  if (!raw) return "Offline";
  const s = raw.toLowerCase();
  if (s === "available") return "Available";
  if (s === "preparing") return "Preparing";
  if (s === "finishing") return "Finishing";
  if (s === "charging") return "Charging";
  if (s.startsWith("suspended")) return "Suspended";
  if (s === "reserved") return "Reserved";
  if (s === "unavailable") return "Unavailable";
  if (s === "faulted" || s.includes("error") || s.includes("fault")) {
    return "Faulted";
  }
  return "Offline";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = define.handlers({
  async GET(ctx) {
    const chargeBoxId = ctx.params.chargeBoxId;
    const isAdmin = ctx.state.user?.role === "admin";

    // 1. Cache row — if this fails we can't render the page at all.
    let cacheRow: schema.Charger | null = null;
    try {
      const [row] = await db
        .select()
        .from(schema.chargers)
        .where(eq(schema.chargers.chargeBoxId, chargeBoxId))
        .limit(1);
      cacheRow = row ?? null;
    } catch (error) {
      logger.error(
        "ChargerDetail",
        "Failed to load charger cache row",
        error as Error,
      );
    }

    if (!cacheRow) {
      return {
        data: {
          charger: null,
          connectors: [],
          recentTransactions: [],
          operationLog: [],
          activeSessions: [],
          isAdmin,
          steveFetchFailed: false,
        } satisfies ChargerDetailLoaderData,
      };
    }

    const isUnmanaged = cacheRow.managementMode === "unmanaged";

    // 2. Parallel pulls — allSettled so the page renders even when a
    // backend hiccups. Includes the `charger_connectors` query so the
    // canonical connector list is always available.
    const [
      txActiveSettled,
      txRecentSettled,
      opLogSettled,
      connectorsSettled,
    ] = isUnmanaged
      ? [
        { status: "fulfilled" as const, value: [] as StEvETransaction[] },
        { status: "fulfilled" as const, value: [] as StEvETransaction[] },
        {
          status: "fulfilled" as const,
          value: [] as Array<{
            id: number;
            operation: string;
            params: unknown;
            status: string;
            taskId: number | null;
            result: unknown;
            createdAt: Date | null;
            completedAt: Date | null;
            requestedByUserId: string | null;
            requestedByEmail: string | null;
          }>,
        },
        {
          status: "fulfilled" as const,
          value: await listConnectors(chargeBoxId).catch(() => []),
        },
      ]
      : await Promise.allSettled([
        steveClient.getTransactions({
          chargeBoxId,
          type: "ACTIVE",
          periodType: "ALL",
        }),
        steveClient.getTransactions({
          chargeBoxId,
          type: "ALL",
          periodType: "LAST_30",
        }),
        db
          .select({
            id: schema.chargerOperationLog.id,
            operation: schema.chargerOperationLog.operation,
            params: schema.chargerOperationLog.params,
            status: schema.chargerOperationLog.status,
            taskId: schema.chargerOperationLog.taskId,
            result: schema.chargerOperationLog.result,
            createdAt: schema.chargerOperationLog.createdAt,
            completedAt: schema.chargerOperationLog.completedAt,
            requestedByUserId: schema.chargerOperationLog.requestedByUserId,
            requestedByEmail: schema.users.email,
          })
          .from(schema.chargerOperationLog)
          .leftJoin(
            schema.users,
            eq(schema.chargerOperationLog.requestedByUserId, schema.users.id),
          )
          .where(eq(schema.chargerOperationLog.chargeBoxId, chargeBoxId))
          .orderBy(desc(schema.chargerOperationLog.createdAt))
          .limit(50),
        listConnectors(chargeBoxId),
      ]);

    const txActive = txActiveSettled.status === "fulfilled"
      ? txActiveSettled.value
      : [];
    const txRecent = txRecentSettled.status === "fulfilled"
      ? txRecentSettled.value
      : [];
    const opRows = opLogSettled.status === "fulfilled"
      ? opLogSettled.value
      : [];
    const connectorRows = connectorsSettled.status === "fulfilled"
      ? connectorsSettled.value
      : [];

    const steveFetchFailed = txActiveSettled.status === "rejected" ||
      txRecentSettled.status === "rejected";

    // 3. Active-tag PK lookup (unchanged).
    let tagPkByIdTag = new Map<
      string,
      { tagPk: number; tagType: string | null }
    >();
    try {
      const idTagsWanted = Array.from(
        new Set([
          ...txActive.map((t) => t.ocppIdTag),
          ...txRecent.slice(0, 20).map((t) => t.ocppIdTag),
        ]),
      );
      if (idTagsWanted.length > 0) {
        const mappings = await db
          .select({
            idTag: schema.userMappings.steveOcppIdTag,
            tagPk: schema.userMappings.steveOcppTagPk,
            tagType: schema.userMappings.tagType,
          })
          .from(schema.userMappings);
        tagPkByIdTag = new Map(
          mappings.map((
            m,
          ) => [m.idTag, { tagPk: m.tagPk, tagType: m.tagType }]),
        );
      }
    } catch (error) {
      logger.warn("ChargerDetail", "userMappings lookup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 4. Active sessions.
    const activeSessions: ActiveSessionCtx[] = txActive.map((t) => ({
      transactionId: t.id,
      connectorId: t.connectorId,
      startTimestampIso: t.startTimestamp,
      idTag: t.ocppIdTag,
    }));

    // 5. Connector merge: union of (DB rows, observed StEvE connector
    // ids). For managed chargers, observed-but-not-stored connectors
    // get auto-inserted (fire-and-forget) so admins can edit their
    // spec on the next render.
    const connectorMap = new Map<number, ConnectorDto>();

    const buildDto = (
      connectorId: number,
      connectorType: string | null,
      maxKw: number | null,
    ): ConnectorDto => {
      const active = txActive.find((t) => t.connectorId === connectorId);
      const activeTagInfo = active
        ? tagPkByIdTag.get(active.ocppIdTag) ?? null
        : null;
      const uiStatus = normalizeConnectorStatus(
        cacheRow!.lastStatus,
        Boolean(active),
      );
      return {
        connectorId,
        rawStatus: cacheRow!.lastStatus,
        uiStatus,
        errorCode: null,
        vendorErrorCode: null,
        info: null,
        updatedAtIso: cacheRow!.lastStatusAt
          ? cacheRow!.lastStatusAt.toISOString()
          : null,
        activeTransactionId: active ? active.id : null,
        activeSessionKwh: null,
        activeSessionStartIso: active ? active.startTimestamp : null,
        activeTagIdTag: active ? active.ocppIdTag : null,
        activeTagTagPk: activeTagInfo?.tagPk ?? null,
        currentKw: null,
        connectorType,
        maxKw,
      };
    };

    for (const row of connectorRows) {
      connectorMap.set(
        row.connectorId,
        buildDto(
          row.connectorId,
          row.connectorType,
          row.maxKw !== null ? Number(row.maxKw) : null,
        ),
      );
    }

    // For managed chargers, seed any connector observed via StEvE
    // that's not yet in the table. Fire-and-forget per the deploy
    // plan; PK conflicts are handled by `onConflictDoNothing()`.
    if (!isUnmanaged) {
      const observed = new Set<number>();
      for (const t of txActive) observed.add(t.connectorId);
      for (const t of txRecent.slice(0, 20)) observed.add(t.connectorId);
      for (const id of observed) {
        if (!connectorMap.has(id)) {
          connectorMap.set(id, buildDto(id, null, null));
          // Background insert; we don't await on it here so the page
          // renders fast. Next request will pick up the row.
          ensureConnectorExists(chargeBoxId, id).catch((err) => {
            logger.warn(
              "ChargerDetail",
              "ensureConnectorExists failed",
              { error: err instanceof Error ? err.message : String(err) },
            );
          });
        }
      }
    }

    // If still empty, seed connector 1 — covers freshly-created
    // unmanaged rows and managed chargers that have never reported.
    if (connectorMap.size === 0) {
      connectorMap.set(1, buildDto(1, null, null));
      ensureConnectorExists(chargeBoxId, 1).catch(() => {});
    }

    const connectors: ConnectorDto[] = Array.from(connectorMap.values())
      .sort((a, b) => a.connectorId - b.connectorId);

    // 6. Recent transactions.
    const recentTransactions: ChargerRecentTxRow[] = txRecent
      .slice()
      .sort((a, b) =>
        new Date(b.startTimestamp).getTime() -
        new Date(a.startTimestamp).getTime()
      )
      .slice(0, 20)
      .map((t) => {
        const tagInfo = tagPkByIdTag.get(t.ocppIdTag) ?? null;
        return {
          steveTransactionId: t.id,
          chargeBoxId: t.chargeBoxId,
          connectorId: t.connectorId,
          idTag: t.ocppIdTag,
          ocppTagPk: tagInfo?.tagPk ?? null,
          tagType: tagInfo?.tagType ?? null,
          startedAtIso: t.startTimestamp,
          stoppedAtIso: t.stopTimestamp,
          stopReason: t.stopReason,
          kwhDelivered: txDeliveredKwh(t),
        };
      });

    // 7. Operation log rows.
    const operationLog: OperationLogRow[] = opRows.map((r) => ({
      id: r.id,
      operation: r.operation as OperationLogRow["operation"],
      params: (r.params ?? null) as Record<string, unknown> | null,
      status: r.status,
      taskId: r.taskId,
      result: (r.result ?? null) as Record<string, unknown> | null,
      requestedByEmail: r.requestedByEmail ?? null,
      requestedAtIso: (r.createdAt ?? new Date()).toISOString(),
      completedAtIso: r.completedAt ? r.completedAt.toISOString() : null,
    }));

    // 8. Freshness.
    const lastStatusAtIso = cacheRow.lastStatusAt
      ? cacheRow.lastStatusAt.toISOString()
      : null;
    const age = lastStatusAtIso
      ? Date.now() - new Date(lastStatusAtIso).getTime()
      : Number.POSITIVE_INFINITY;
    const isStale = !isUnmanaged && age > STALE_DIM_MS &&
      age <= OFFLINE_AFTER_MS;
    const isOffline = !isUnmanaged && age > OFFLINE_AFTER_MS;

    // Unmanaged chargers don't speak OCPP and have no offline concept —
    // always render as "Available". Managed chargers go through the
    // normal status normalization.
    const uiStatus: UiStatus = isUnmanaged ? "Available" : normalizeStatus(
      cacheRow.lastStatus,
      lastStatusAtIso,
      activeSessions.length > 0,
    );

    const capabilities = (cacheRow.capabilities ?? ["charger"]).filter(
      (c): c is DeviceCapability =>
        c === "charger" || c === "scanner" || c === "user" || c === "kiosk",
    );

    // Effective identity values: override takes precedence; StEvE 3.12.0
    // doesn't expose vendor/model/firmware over its API yet, so the
    // StEvE source is null today. When that changes, replace `null`
    // here with the StEvE-fetched value.
    const steveVendor: string | null = null;
    const steveModel: string | null = null;
    const steveFirmware: string | null = null;

    const data: ChargerDetailLoaderData = {
      charger: {
        chargeBoxId: cacheRow.chargeBoxId,
        publicId: cacheRow.publicId,
        friendlyName: cacheRow.friendlyName,
        formFactor: cacheRow.formFactor,
        capabilities,
        firstSeenAtIso: (cacheRow.firstSeenAt ?? new Date()).toISOString(),
        lastSeenAtIso: (cacheRow.lastSeenAt ?? new Date()).toISOString(),
        lastStatus: cacheRow.lastStatus,
        lastStatusAtIso,
        vendor: cacheRow.vendorOverride ?? steveVendor,
        vendorOverride: cacheRow.vendorOverride,
        model: cacheRow.modelOverride ?? steveModel,
        modelOverride: cacheRow.modelOverride,
        firmwareVersion: cacheRow.firmwareVersionOverride ?? steveFirmware,
        firmwareVersionOverride: cacheRow.firmwareVersionOverride,
        registrationStatus: null,
        uiStatus,
        isStale,
        isOffline,
        managementMode: isUnmanaged ? "unmanaged" : "ocpp",
        locationDescription: cacheRow.locationDescription,
        addressLine1: cacheRow.addressLine1,
        addressLine2: cacheRow.addressLine2,
        addressCity: cacheRow.addressCity,
        addressRegion: cacheRow.addressRegion,
        addressPostalCode: cacheRow.addressPostalCode,
        addressCountry: cacheRow.addressCountry,
        latitude: cacheRow.latitude !== null ? Number(cacheRow.latitude) : null,
        longitude: cacheRow.longitude !== null
          ? Number(cacheRow.longitude)
          : null,
      },
      connectors,
      recentTransactions,
      operationLog,
      activeSessions,
      isAdmin,
      steveFetchFailed,
    };

    return { data };
  },
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default define.page<typeof handler>(
  function ChargerDetailPage({ data, url, state }) {
    const charger = data.charger;

    if (!charger) {
      return (
        <SidebarLayout
          currentPath={url.pathname}
          user={state.user}
          accentColor="orange"
        >
          <PageCard title="Charger not found" colorScheme="orange">
            <div class="py-8 text-center text-muted-foreground">
              This charger isn't in our cache yet.{" "}
              <a
                href="/devices?type=charger"
                class="text-primary underline-offset-4 hover:underline"
              >
                Back to chargers
              </a>
            </div>
          </PageCard>
        </SidebarLayout>
      );
    }

    const isUnmanaged = charger.managementMode === "unmanaged";
    const accent = isUnmanaged ? "blue" : "orange";

    // Title rules: prefer friendlyName; for unmanaged with no friendly
    // name, use a humanised fallback so the page title isn't a raw
    // nanoid. The chargeBoxId chip below the strip carries the full
    // nanoid (allowed to wrap two-line — no truncation).
    const displayName = charger.friendlyName ??
      (isUnmanaged ? "Unmanaged charger" : charger.chargeBoxId);

    // Active session for the right-side mini-summary on the strip.
    const activeForStrip = data.activeSessions[0]
      ? {
        transactionId: data.activeSessions[0].transactionId,
        connectorId: data.activeSessions[0].connectorId,
        startTimestampIso: data.activeSessions[0].startTimestampIso,
        idTag: data.activeSessions[0].idTag,
      }
      : null;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor={accent}
      >
        <PageCard
          title={displayName}
          colorScheme={accent}
          topRightAccessory={
            <PublicIdQrPopover
              entity="charger"
              publicId={charger.publicId}
              size="md"
            />
          }
        >
          <div class="flex flex-col gap-6">
            {/* Status strip — pills + heartbeat + Refresh + active-session */}
            <ChargerHeaderStrip
              chargeBoxId={charger.chargeBoxId}
              isUnmanaged={isUnmanaged}
              registrationStatus={charger.registrationStatus}
              uiStatus={charger.uiStatus}
              isStale={charger.isStale}
              isOffline={charger.isOffline}
              lastStatusAtIso={charger.lastStatusAtIso}
              connectors={data.connectors.map((c) => ({
                uiStatus: c.uiStatus,
              }))}
              activeSession={activeForStrip}
              steveFetchFailed={data.steveFetchFailed}
            />

            {/* Hero: identity (1/3) + Location/Capabilities stacked (2/3) */}
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <ChargerIdentityCard
                class="lg:col-span-1"
                chargeBoxId={charger.chargeBoxId}
                friendlyName={charger.friendlyName}
                formFactor={charger.formFactor}
                firstSeenAtIso={charger.firstSeenAtIso}
                lastSeenAtIso={charger.lastSeenAtIso}
                vendor={charger.vendor}
                vendorOverride={charger.vendorOverride}
                model={charger.model}
                modelOverride={charger.modelOverride}
                firmwareVersion={charger.firmwareVersion}
                firmwareVersionOverride={charger.firmwareVersionOverride}
                uiStatus={charger.uiStatus}
                isAdmin={data.isAdmin}
              />
              <div class="flex flex-col gap-6 lg:col-span-2">
                <SectionCard title="Location" accent={accent} icon={MapPin}>
                  <ChargerLocationEditor
                    chargeBoxId={charger.chargeBoxId}
                    initial={{
                      addressLine1: charger.addressLine1,
                      addressLine2: charger.addressLine2,
                      addressCity: charger.addressCity,
                      addressRegion: charger.addressRegion,
                      addressPostalCode: charger.addressPostalCode,
                      addressCountry: charger.addressCountry,
                      latitude: charger.latitude,
                      longitude: charger.longitude,
                    }}
                  />
                </SectionCard>

                {data.isAdmin && (
                  <SectionCard
                    title="Capabilities"
                    description="Admin-editable capabilities for this charger."
                    icon={Settings2}
                    accent={accent}
                  >
                    <AppConfigurationForm
                      deviceId={charger.chargeBoxId}
                      kind="charger"
                      current={charger.capabilities}
                    />
                  </SectionCard>
                )}
              </div>
            </div>

            {/* Full-width Connectors card */}
            <ConnectorsSection
              chargeBoxId={charger.chargeBoxId}
              connectors={data.connectors}
              isAdmin={data.isAdmin}
              isUnmanaged={isUnmanaged}
              accent={accent}
            />

            {/* Managed-only: recent tx + operation audit, side-by-side at xl */}
            {!isUnmanaged && (
              <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ChargerRecentTransactionsSection
                  chargeBoxId={charger.chargeBoxId}
                  rows={data.recentTransactions}
                  steveFetchFailed={data.steveFetchFailed}
                  accent={accent}
                />
                <SectionCard
                  title="Operation audit"
                  description={`Last ${data.operationLog.length} entries`}
                  icon={ClipboardList}
                  accent={accent}
                >
                  <ChargerOperationLogTable
                    rows={data.operationLog}
                    isAdmin={data.isAdmin}
                  />
                </SectionCard>
              </div>
            )}

            {/* Managed-only: Remote actions palette */}
            {data.isAdmin && !isUnmanaged && (
              <RemoteActionsPanel
                chargeBoxId={charger.chargeBoxId}
                friendlyName={charger.friendlyName}
                activeSessions={data.activeSessions.map((s) => ({
                  connectorId: s.connectorId,
                  transactionId: s.transactionId,
                  startTimestampIso: s.startTimestampIso,
                }))}
              />
            )}
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);
