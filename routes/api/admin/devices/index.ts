/**
 * ExpresScan / Wave 2 Track B-admin — admin device listing.
 *
 * GET /api/admin/devices
 *   ?kind=charger|phone_nfc|laptop_nfc
 *   ?capability=tap|ev
 *   ?online=true|false
 *   ?ownerId=<userId>
 *   ?limit=<1..200, default 50>
 *   ?offset=<>=0, default 0>
 *
 * Queries the `tappable_devices` view (migration 0035) so chargers + phones
 * surface uniformly. The view is intentionally schemaless from Drizzle's
 * point of view, so we use `db.execute(sql\`…\`)` with parametrized filters.
 *
 * Online cutoff is kind-dependent:
 *   - chargers   → `last_seen_at` within 600s
 *   - phones     → `last_seen_at` within 90s
 *
 * Auth: admin cookie session (enforced by middleware; we re-assert role for
 * defense-in-depth and to short-circuit the 401 case if middleware ever
 * changes). Bearer auth is rejected at the middleware layer for /api/admin/*
 * paths so it can't reach this handler.
 *
 * Response shape: `{ ok: true, devices: DeviceSummary[], total }`. Total is
 * the unfiltered-by-pagination count so callers can render "showing 1–50 of
 * 312" without a second round-trip.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
  type DeviceKind,
  type DeviceSummary,
} from "../../../../src/lib/types/devices.ts";

const log = logger.child("AdminDevicesList");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Online cutoff for chargers (legacy expectation; matches scan-charger-list pattern of "10min" relaxed). */
const CHARGER_ONLINE_WINDOW_MS = 600 * 1000;
/** Online cutoff for phones — much tighter because heartbeat cadence is short. */
const PHONE_ONLINE_WINDOW_MS = 90 * 1000;

/** Allowed `kind` filter values — note "charger" is a synthetic view kind, not a device row. */
const KIND_FILTER_VALUES = ["charger", "phone_nfc", "laptop_nfc"] as const;
type KindFilter = typeof KIND_FILTER_VALUES[number];

type ViewRow = {
  id: string;
  kind: string;
  label: string;
  capabilities: string[];
  owner_user_id: string | null;
  registered_at: string | Date;
  last_seen_at: string | Date | null;
  /** Joined from `devices` for phones; NULL for chargers. */
  platform: string | null;
  model: string | null;
  app_version: string | null;
  // Index signature required by Drizzle's `db.execute<T>` generic
  // (T extends Record<string, unknown>). Doesn't change runtime behavior.
  [key: string]: unknown;
};

function badRequest(error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function isOnline(kind: string, lastSeenAtMs: number | null): boolean {
  if (lastSeenAtMs === null) return false;
  const window = kind === "charger"
    ? CHARGER_ONLINE_WINDOW_MS
    : PHONE_ONLINE_WINDOW_MS;
  return (Date.now() - lastSeenAtMs) <= window;
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

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return unauthorized();
    }

    const url = new URL(ctx.req.url);

    // --- Parse + validate query params -----------------------------------
    const kindParam = url.searchParams.get("kind");
    if (
      kindParam !== null &&
      !KIND_FILTER_VALUES.includes(kindParam as KindFilter)
    ) {
      return badRequest(
        `invalid_kind: must be one of ${KIND_FILTER_VALUES.join(", ")}`,
      );
    }
    const kindFilter = kindParam as KindFilter | null;

    const capabilityParam = url.searchParams.get("capability");
    if (
      capabilityParam !== null &&
      !(DEVICE_CAPABILITIES as readonly string[]).includes(capabilityParam)
    ) {
      return badRequest(
        `invalid_capability: must be one of ${DEVICE_CAPABILITIES.join(", ")}`,
      );
    }
    const capabilityFilter = capabilityParam as DeviceCapability | null;

    const onlineParam = url.searchParams.get("online");
    let onlineFilter: boolean | null = null;
    if (onlineParam !== null) {
      if (onlineParam === "true") onlineFilter = true;
      else if (onlineParam === "false") onlineFilter = false;
      else return badRequest("invalid_online: must be 'true' or 'false'");
    }

    const ownerIdFilter = url.searchParams.get("ownerId");
    if (ownerIdFilter !== null && ownerIdFilter.length > 200) {
      return badRequest("invalid_ownerId");
    }

    const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
      : DEFAULT_LIMIT;
    const offsetRaw = parseInt(url.searchParams.get("offset") ?? "", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    // --- Query ------------------------------------------------------------
    //
    // The view's column shape doesn't include platform / model / app_version
    // because those are device-only fields; we LEFT JOIN `devices` so phones
    // get them populated and chargers stay NULL. The JOIN key matches
    // `tappable_devices.id::uuid = devices.id` only for the device half of
    // the union, which is exactly what we want.
    //
    // We compute `total` against the same WHERE clause via a CTE so a single
    // round-trip serves both the page slice and the count.
    try {
      const baseWhere = sql`
        ${kindFilter ? sql`tv.kind = ${kindFilter}` : sql`TRUE`}
        AND ${
        capabilityFilter
          ? sql`${capabilityFilter}::text = ANY(tv.capabilities)`
          : sql`TRUE`
      }
        AND ${
        ownerIdFilter ? sql`tv.owner_user_id = ${ownerIdFilter}` : sql`TRUE`
      }
      `;

      const result = await db.execute<ViewRow & { total: string }>(sql`
        WITH filtered AS (
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
          LEFT JOIN devices d
            ON tv.kind <> 'charger'
            AND d.id::text = tv.id
          WHERE ${baseWhere}
        ),
        counted AS (
          SELECT COUNT(*)::bigint AS total FROM filtered
        )
        SELECT
          f.*,
          (SELECT total FROM counted)::text AS total
        FROM filtered f
        ORDER BY f.last_seen_at DESC NULLS LAST, f.registered_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const rows: (ViewRow & { total: string })[] = Array.isArray(result)
        ? (result as unknown as (ViewRow & { total: string })[])
        : ((result as { rows?: (ViewRow & { total: string })[] }).rows ?? []);

      // Online filter is post-query because the cutoff is dynamic relative
      // to "now" and varies by kind. Keeps the SQL simple. The total count
      // reflects pre-online-filter rows — that matches the contract because
      // online status is a derived view, not a stored column.
      const mapped: DeviceSummary[] = rows
        .map((r): { row: ViewRow; online: boolean } => {
          const lastMs = toMs(r.last_seen_at);
          return { row: r, online: isOnline(r.kind, lastMs) };
        })
        .filter(({ online }) => {
          if (onlineFilter === null) return true;
          return online === onlineFilter;
        })
        .map(({ row, online }): DeviceSummary => ({
          deviceId: row.id,
          // The view emits 'charger' | 'phone_nfc' | 'laptop_nfc'. Our
          // DeviceKind union only covers the latter two; charger rows are
          // surfaced here with kind='phone_nfc' fallback would be a lie, so
          // we keep the literal — the cast is intentional and documented.
          kind: row.kind as DeviceKind,
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
          isOnline: online,
          registeredAtIso: toIso(row.registered_at) ??
            new Date(0).toISOString(),
        }));

      const total = rows.length > 0 ? Number(rows[0].total) : 0;

      return new Response(
        JSON.stringify({ ok: true, devices: mapped, total }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      log.error("Failed to list devices", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ error: "internal_error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
