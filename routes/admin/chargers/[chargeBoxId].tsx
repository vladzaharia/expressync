/**
 * Charge Box Details page (`/chargers/[chargeBoxId]`).
 *
 * Rebuild scope (see plan `polaris-express-is-an-streamed-crown.md`):
 *   - Header strip (friendlyName + chargeBoxId + status pills)
 *   - Identity card (island) + live-status card (island), 1+2 split at lg:
 *   - Per-connector grid (island)
 *   - Recent transactions + operation audit log, side-by-side at xl:
 *   - Admin-only Remote Actions palette
 *
 * Loader notes:
 *   - Pulls the sticky charger row from `chargers_cache`.
 *   - `Promise.allSettled` for StEvE + DB side-calls so a transient StEvE
 *     failure (or a missing transactions table row) doesn't nuke the page.
 *   - `steveFetchFailed` bubbles up as a banner flag on the live-status card.
 *   - Reservations / raw-cache sections are deferred (explicit per plan
 *     scope notes); the sections above are the DoD surface.
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
import ChargerIdentityCard from "../../../islands/ChargerIdentityCard.tsx";
import ChargerLiveStatusCard from "../../../islands/ChargerLiveStatusCard.tsx";
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
import { ClipboardList } from "lucide-preact";

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
    chargeBoxPk: number | null;
    friendlyName: string | null;
    formFactor: string;
    firstSeenAtIso: string;
    lastSeenAtIso: string;
    lastStatus: string | null;
    lastStatusAtIso: string | null;

    // StEvE-augmented fields (nullable when StEvE is unreachable).
    ocppProtocol: string | null;
    vendor: string | null;
    model: string | null;
    firmwareVersion: string | null;
    iccid: string | null;
    registrationStatus: "Accepted" | "Pending" | "Rejected" | null;

    // Derived
    uiStatus: UiStatus;
    isStale: boolean;
    isOffline: boolean;
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

/**
 * Per-connector UI bucket — similar shape to `normalizeStatus` but we keep
 * Preparing/Finishing/Suspended distinct per the plan's connector-card color
 * spec. Falls back to Offline when we've got no data.
 */
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
    let cacheRow: schema.ChargerCache | null = null;
    try {
      const [row] = await db
        .select()
        .from(schema.chargersCache)
        .where(eq(schema.chargersCache.chargeBoxId, chargeBoxId))
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

    // 2. Parallel pulls — allSettled so the page renders even when StEvE or
    //    the operation log query hiccups.
    const [
      txActiveSettled,
      txRecentSettled,
      opLogSettled,
    ] = await Promise.allSettled([
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

    const steveFetchFailed = txActiveSettled.status === "rejected" ||
      txRecentSettled.status === "rejected";

    if (txActiveSettled.status === "rejected") {
      logger.warn(
        "ChargerDetail",
        "Active transactions fetch failed — rendering from cache",
        { error: String(txActiveSettled.reason) },
      );
    }
    if (txRecentSettled.status === "rejected") {
      logger.warn(
        "ChargerDetail",
        "Recent transactions fetch failed — rendering from cache",
        { error: String(txRecentSettled.reason) },
      );
    }
    if (opLogSettled.status === "rejected") {
      logger.warn(
        "ChargerDetail",
        "Operation log fetch failed — rendering empty audit table",
        { error: String(opLogSettled.reason) },
      );
    }

    // 3. Look up active-tag PKs in DB via userMappings so we can link the
    //    TagChip to /tags/[tagPk]. One batched query keeps the loader fast.
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

    // 4. Build active session contexts per connector. StEvE 3.12.0 doesn't
    //    expose a connector-status endpoint, so the "Charging" indicator
    //    comes from active transactions and everything else leans on the
    //    cached `last_status`. When we add a connector-status table later
    //    this block merges in without rewriting the page.
    const activeSessions: ActiveSessionCtx[] = txActive.map((t) => ({
      transactionId: t.id,
      connectorId: t.connectorId,
      startTimestampIso: t.startTimestamp,
      idTag: t.ocppIdTag,
    }));

    const connectorIdSet = new Set<number>();
    for (const t of txActive) connectorIdSet.add(t.connectorId);
    for (const t of txRecent.slice(0, 20)) connectorIdSet.add(t.connectorId);
    // Most chargers ship with connector 1 — surface it even with no data.
    if (connectorIdSet.size === 0) connectorIdSet.add(1);

    const connectors: ConnectorDto[] = Array.from(connectorIdSet)
      .sort((a, b) => a - b)
      .map((connectorId) => {
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
          // Live kWh isn't available without a stop value — leave null; the
          // per-connector card renders "—" for null. Future work (Phase E1
          // meter-value pump) will populate this from StEvE live meter reads.
          activeSessionKwh: null,
          activeSessionStartIso: active ? active.startTimestamp : null,
          activeTagIdTag: active ? active.ocppIdTag : null,
          activeTagTagPk: activeTagInfo?.tagPk ?? null,
          currentKw: null,
        };
      });

    // 5. Recent transactions table rows (limit 20, newest first).
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

    // 6. Operation log rows for the island.
    const operationLog: OperationLogRow[] = opRows.map((r) => ({
      id: r.id,
      // operation is `text` in the DB — coerce to the named union at the
      // boundary; the island treats unknown strings gracefully.
      operation: r.operation as OperationLogRow["operation"],
      params: (r.params ?? null) as Record<string, unknown> | null,
      status: r.status,
      taskId: r.taskId,
      result: (r.result ?? null) as Record<string, unknown> | null,
      requestedByEmail: r.requestedByEmail ?? null,
      requestedAtIso: (r.createdAt ?? new Date()).toISOString(),
      completedAtIso: r.completedAt ? r.completedAt.toISOString() : null,
    }));

    // 7. Derive freshness buckets from the cache timestamps.
    const lastStatusAtIso = cacheRow.lastStatusAt
      ? cacheRow.lastStatusAt.toISOString()
      : null;
    const age = lastStatusAtIso
      ? Date.now() - new Date(lastStatusAtIso).getTime()
      : Number.POSITIVE_INFINITY;
    const isStale = age > STALE_DIM_MS && age <= OFFLINE_AFTER_MS;
    const isOffline = age > OFFLINE_AFTER_MS;

    const uiStatus = normalizeStatus(
      cacheRow.lastStatus,
      lastStatusAtIso,
      activeSessions.length > 0,
    );

    const data: ChargerDetailLoaderData = {
      charger: {
        chargeBoxId: cacheRow.chargeBoxId,
        chargeBoxPk: cacheRow.chargeBoxPk,
        friendlyName: cacheRow.friendlyName,
        formFactor: cacheRow.formFactor,
        firstSeenAtIso: (cacheRow.firstSeenAt ?? new Date()).toISOString(),
        lastSeenAtIso: (cacheRow.lastSeenAt ?? new Date()).toISOString(),
        lastStatus: cacheRow.lastStatus,
        lastStatusAtIso,
        // StEvE 3.12.0 doesn't expose these yet — null placeholders so the
        // identity card renders the "—" fallback. When a status-details
        // endpoint lands, we'll wire it in via Promise.allSettled above.
        ocppProtocol: null,
        vendor: null,
        model: null,
        firmwareVersion: null,
        iccid: null,
        registrationStatus: null,
        uiStatus,
        isStale,
        isOffline,
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

    const displayName = charger.friendlyName ?? charger.chargeBoxId;

    const activeSessionForLive = data.activeSessions[0]
      ? {
        transactionId: data.activeSessions[0].transactionId,
        connectorId: data.activeSessions[0].connectorId,
        startTimestampIso: data.activeSessions[0].startTimestampIso,
        idTag: data.activeSessions[0].idTag,
        currentKw: null,
        sessionKwh: null,
      }
      : null;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="orange"
      >
        <PageCard
          title={displayName}
          colorScheme="orange"
        >
          <div class="flex flex-col gap-6">
            {/* Header strip — identity + status pills */}
            <ChargerHeaderStrip
              chargeBoxId={charger.chargeBoxId}
              friendlyName={charger.friendlyName}
              registrationStatus={charger.registrationStatus}
              uiStatus={charger.uiStatus}
              isStale={charger.isStale}
              isOffline={charger.isOffline}
              lastStatusAtIso={charger.lastStatusAtIso}
              connectors={data.connectors.map((c) => ({
                uiStatus: c.uiStatus,
              }))}
            />

            {/* Row 1: identity + live status, 1+2 split at lg: */}
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <ChargerIdentityCard
                class="lg:col-span-1"
                chargeBoxId={charger.chargeBoxId}
                chargeBoxPk={charger.chargeBoxPk}
                friendlyName={charger.friendlyName}
                formFactor={charger.formFactor}
                firstSeenAtIso={charger.firstSeenAtIso}
                lastSeenAtIso={charger.lastSeenAtIso}
                ocppProtocol={charger.ocppProtocol}
                vendor={charger.vendor}
                model={charger.model}
                firmwareVersion={charger.firmwareVersion}
                iccid={charger.iccid}
                uiStatus={charger.uiStatus}
                isAdmin={data.isAdmin}
              />
              <ChargerLiveStatusCard
                class="lg:col-span-2"
                chargeBoxId={charger.chargeBoxId}
                uiStatus={charger.uiStatus}
                lastStatus={charger.lastStatus}
                lastStatusAtIso={charger.lastStatusAtIso}
                isStale={charger.isStale}
                isOffline={charger.isOffline}
                activeSession={activeSessionForLive}
                steveFetchFailed={data.steveFetchFailed}
              />
            </div>

            {/* Row 2: connector cards */}
            <ConnectorsSection
              chargeBoxId={charger.chargeBoxId}
              connectors={data.connectors}
              isAdmin={data.isAdmin}
            />

            {/* Row 3: recent tx + operation audit, side-by-side at xl: */}
            <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <ChargerRecentTransactionsSection
                chargeBoxId={charger.chargeBoxId}
                rows={data.recentTransactions}
                steveFetchFailed={data.steveFetchFailed}
              />
              <SectionCard
                title="Operation audit"
                description={`Last ${data.operationLog.length} entries`}
                icon={ClipboardList}
                accent="orange"
              >
                <ChargerOperationLogTable
                  rows={data.operationLog}
                  isAdmin={data.isAdmin}
                />
              </SectionCard>
            </div>

            {/* Row 4: admin-only actions palette */}
            {data.isAdmin && (
              <RemoteActionsPanel
                chargeBoxId={charger.chargeBoxId}
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
