/**
 * ExpresScan / Wave 2 Track B-admin — unified tap-target picker.
 *
 * GET /api/auth/scan-tap-targets
 *
 * Replaces the legacy `/api/auth/scan-charger-list` endpoint. Returns a
 * unified roster of tap-capable targets — chargers from `chargers_cache`
 * AND phones from `devices` — so the scan-modal picker (D3 in Wave 4) can
 * present one list instead of two.
 *
 * Pulls from the `tappable_devices` view (migration 0035) and filters to
 * `'tap' = ANY(capabilities) AND deleted_at IS NULL`. Phones whose owner
 * matches `ctx.state.user?.id` get `isOwnDevice: true` so the admin
 * surface can group "My phone" vs "Other devices".
 *
 * Auth: cookie session (admin or customer; both surfaces use this picker).
 * The `assertSameOrigin` check fires on writes only, so a GET from the
 * customer login page still works without a session by way of the
 * route-classifier — but most callers are authenticated.
 *
 * Rate-limit: 30/min/IP (mirrors the legacy `scan-charger-list.ts` cap so
 * abuse profiles don't change).
 *
 * Online cutoff is per-kind:
 *   - chargers   → `last_seen_at` within 600 s
 *   - phones     → `last_seen_at` within 90 s
 *
 * Response shape: `{ ok: true, devices: TapTargetEntry[] }`. Note we keep
 * the field name `devices` per `20-contracts.md` row 14 even though the
 * list contains both chargers AND phones — the discriminator is the
 * `pairableType` field on each row.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
  type TapTargetEntry,
} from "../../../src/lib/types/devices.ts";

const log = logger.child("ScanTapTargets");

const RATE_LIMIT_PER_IP = 30;
/** Online cutoff for chargers — matches scan-charger-list's legacy 10-minute window. */
const CHARGER_ONLINE_WINDOW_MS = 10 * 60 * 1000;
/** Online cutoff for phones — heartbeats are short, so this is tight. */
const PHONE_ONLINE_WINDOW_MS = 90 * 1000;

type ViewRow = {
  id: string;
  kind: string;
  label: string;
  capabilities: string[];
  owner_user_id: string | null;
  last_seen_at: string | Date | null;
  // Index signature required by Drizzle's `db.execute<T>` generic
  // (T extends Record<string, unknown>). Doesn't change runtime behavior.
  [key: string]: unknown;
};

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function rateLimited(): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

function toMs(v: string | Date | null): number | null {
  if (v === null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

function isOnline(kind: string, lastSeenAtMs: number | null): boolean {
  if (lastSeenAtMs === null) return false;
  const window = kind === "charger"
    ? CHARGER_ONLINE_WINDOW_MS
    : PHONE_ONLINE_WINDOW_MS;
  return (Date.now() - lastSeenAtMs) <= window;
}

export const handler = define.handlers({
  async GET(ctx) {
    const ip = getClientIp(ctx.req);
    if (!await checkRateLimit(`scantap:${ip}`, RATE_LIMIT_PER_IP)) {
      return rateLimited();
    }

    const sessionUserId = ctx.state.user?.id ?? null;

    try {
      // Filter `'tap' = ANY(capabilities)` and `deleted_at IS NULL` server-
      // side. The view already excludes soft-deleted devices via its WHERE
      // clause (see migration 0035), but we keep the redundant guard so a
      // future view rewrite can't accidentally surface revoked rows.
      const result = await db.execute<ViewRow>(sql`
        SELECT
          id,
          kind,
          label,
          capabilities,
          owner_user_id,
          last_seen_at
        FROM tappable_devices
        WHERE 'tap' = ANY(capabilities)
          AND deleted_at IS NULL
        ORDER BY last_seen_at DESC NULLS LAST
      `);

      const rows: ViewRow[] = Array.isArray(result)
        ? (result as unknown as ViewRow[])
        : ((result as { rows?: ViewRow[] }).rows ?? []);

      const targets: TapTargetEntry[] = rows.map((r): TapTargetEntry => {
        const lastMs = toMs(r.last_seen_at);
        const online = isOnline(r.kind, lastMs);
        const pairableType: TapTargetEntry["pairableType"] =
          r.kind === "charger" ? "charger" : "device";
        const filteredCaps: DeviceCapability[] = (r.capabilities ?? []).filter(
          (c): c is DeviceCapability =>
            (DEVICE_CAPABILITIES as readonly string[]).includes(c),
        );
        const entry: TapTargetEntry = {
          deviceId: r.id,
          pairableType,
          // The view's kind column emits 'charger' | 'phone_nfc' | 'laptop_nfc'
          // which is exactly what `TapTargetEntry.kind` accepts.
          kind: r.kind as TapTargetEntry["kind"],
          label: r.label,
          capabilities: filteredCaps,
          isOnline: online,
        };
        // Only stamp isOwnDevice on phone rows whose owner matches the
        // current session user. Chargers don't have owners; the admin
        // surface uses this hint to highlight "your phone" in the picker.
        if (
          pairableType === "device" &&
          sessionUserId !== null &&
          r.owner_user_id === sessionUserId
        ) {
          entry.isOwnDevice = true;
        }
        return entry;
      });

      return new Response(
        JSON.stringify({ ok: true, devices: targets }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      log.error("Failed to list tap targets", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-soft for the picker — return an empty list rather than 500
      // so the UI can render its empty state. Mirrors the original
      // `scan-charger-list` fail-open behavior.
      return new Response(
        JSON.stringify({ ok: true, devices: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
