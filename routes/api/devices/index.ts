/**
 * ExpresScan v2 / Wave 6 Slice I — Chargers list for the iOS Chargers tab.
 *
 * GET /api/devices
 *
 * Bearer-auth'd device-API endpoint. Returns the org's chargers as a
 * flat list, sorted by recency, capped at 100. Used by the iOS
 * `ChargersTabView` to populate its list. App devices (`phone_nfc` /
 * `tablet_nfc` / `laptop_nfc`) are filtered out — non-charger device
 * management lives only on the web admin in this PR. Apps that don't
 * have the `user` capability cannot see the list at all (403).
 *
 * Source: the `tappable_devices` view (chargers + apps unioned)
 * filtered to `kind = 'charger'`, left-joined to `chargers_cache` for
 * `friendly_name` + `form_factor` + `last_status` / `last_status_at`.
 *
 * Online window: 90 s — mirrors `requireOnlineCharger` so the UI's
 * online bubble is consistent across the iOS list and the charger
 * action endpoints.
 *
 * Pre-flight rejections:
 *   401 unauthorized       — no bearer / no `ctx.state.device`
 *   403 capability_denied  — caller lacks `user` capability
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../src/lib/devices/capability-gate.ts";
import { CHARGER_ONLINE_WINDOW_MS } from "../../../src/lib/chargers/online.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DevicesChargerList");

/** Cap on the returned list. Friends-and-family deployment never
 * exceeds this; bigger fleets would need pagination — out of scope. */
const MAX_ROWS = 100;

/** Wire-side state enum the iOS app expects. */
const CHARGER_STATES = [
  "idle",
  "preparing",
  "charging",
  "reserved",
  "outOfService",
  "offline",
] as const;
type ChargerState = (typeof CHARGER_STATES)[number];

/** Strict response row — must match the iOS `ChargerListEntry` Codable. */
const ChargerRowSchema = z.object({
  chargerId: z.string(),
  label: z.string(),
  siteName: z.string().nullable(),
  formFactor: z.enum([
    "wallbox",
    "pulsar",
    "commander",
    "wall_mount",
    "generic",
  ]),
  connectorType: z.enum(["ccs", "j1772", "nacs", "chademo", "type2"])
    .nullable(),
  maxKw: z.number().nullable(),
  state: z.enum(CHARGER_STATES),
  lastSeenAt: z.string().nullable(),
  /** Per-row capability set from `chargers_cache.capabilities`.
   *  Always carries `'charger'` (auto-managed by StEvE sync); may also
   *  carry `'scanner'` when the charger has built-in NFC. The iOS
   *  Chargers list reads this to render the NFC pill on rows that
   *  include `"scanner"`. */
  capabilities: z.array(z.string()),
}).strict();

const ResponseSchema = z.object({
  chargers: z.array(ChargerRowSchema),
}).strict();

export type ChargerRow = z.infer<typeof ChargerRowSchema>;
export type ChargersListResponse = z.infer<typeof ResponseSchema>;

type ViewRow = {
  id: string;
  kind: string;
  label: string;
  last_seen_at: Date | string | null;
  last_status_at: Date | string | null;
  last_status: string | null;
  friendly_name: string | null;
  form_factor: string | null;
  capabilities?: string[] | null;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

/**
 * Map StEvE's free-text `last_status` string + the 90 s `last_status_at`
 * cutoff to the wire enum the iOS app consumes.
 *
 * Mirrors the soft-offline logic in `routes/api/auth/scan-tap-targets.ts`:
 * "Offline", "Faulted", "Error", "Unavailable" all collapse to `offline`.
 * If `last_status_at` is missing or stale, we surface `offline` regardless
 * of the textual status — protects against zombie rows.
 */
export function mapChargerState(
  lastStatus: string | null,
  lastStatusAtMs: number | null,
  now: number = Date.now(),
): ChargerState {
  if (lastStatusAtMs === null) return "offline";
  if (now - lastStatusAtMs > CHARGER_ONLINE_WINDOW_MS) return "offline";
  if (!lastStatus) return "offline";
  const s = lastStatus.toLowerCase();
  if (s.includes("offline")) return "offline";
  if (s.includes("fault") || s.includes("error")) return "outOfService";
  if (s.includes("unavail")) return "outOfService";
  if (s.includes("charg")) return "charging";
  if (s.includes("reserv")) return "reserved";
  if (s.includes("prepar")) return "preparing";
  return "idle";
}

function normalizeFormFactor(v: string | null): ChargerRow["formFactor"] {
  switch (v) {
    case "pulsar":
    case "commander":
    case "wall_mount":
    case "generic":
      return v;
    case "wallbox":
    default:
      return "wallbox";
  }
}

// ---------------------------------------------------------------------------
// Test seam — handler-direct DB shim. Tests inject a fake loader to avoid
// requiring DATABASE_URL.
// ---------------------------------------------------------------------------

type ChargerListLoader = () => Promise<ViewRow[]>;

const defaultLoader: ChargerListLoader = async () => {
  const result = await db.execute<ViewRow>(sql`
    SELECT
      tv.id,
      tv.kind,
      tv.label,
      tv.last_seen_at,
      cc.last_status_at,
      cc.last_status,
      cc.friendly_name,
      cc.form_factor,
      cc.capabilities
    FROM tappable_devices tv
    LEFT JOIN chargers_cache cc
      ON tv.kind = 'charger' AND cc.charge_box_id = tv.id
    WHERE tv.kind = 'charger'
      AND tv.deleted_at IS NULL
    ORDER BY tv.last_seen_at DESC NULLS LAST
    LIMIT ${MAX_ROWS}
  `);
  return Array.isArray(result)
    ? (result as unknown as ViewRow[])
    : ((result as { rows?: ViewRow[] }).rows ?? []);
};

let listLoader: ChargerListLoader = defaultLoader;

export function _setChargerListLoaderForTests(
  fn: ChargerListLoader | null,
): void {
  listLoader = fn ?? defaultLoader;
}
export function _resetChargerListTestSeams(): void {
  listLoader = defaultLoader;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.device) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    try {
      await requireCapability(ctx, "user");
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "capability_denied",
          missing: err.missing,
        });
      }
      throw err;
    }

    let rows: ViewRow[];
    try {
      rows = await listLoader();
    } catch (err) {
      log.error("charger list query failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    const now = Date.now();
    const chargers: ChargerRow[] = rows
      .filter((r) => r.kind === "charger")
      .map((r) => {
        // Defensive: the DB CHECK guarantees `'charger'` is present
        // on every charger row, but force-include it here so a
        // partially-migrated row can't drop the auto-managed cap.
        const caps = new Set(r.capabilities ?? []);
        caps.add("charger");
        return {
          chargerId: r.id,
          label: r.friendly_name ?? r.label,
          // siteName: not modelled today; reserved for future multi-site rollout.
          siteName: null,
          formFactor: normalizeFormFactor(r.form_factor),
          // connectorType + maxKw aren't tracked on `chargers_cache` today;
          // reserved for the connector-metadata follow-up (slice B5b in the plan).
          connectorType: null,
          maxKw: null,
          state: mapChargerState(r.last_status, toMs(r.last_status_at), now),
          // The wire field is named `lastSeenAt` for backward
          // compatibility, but it's the time we last received a real
          // OCPP status from the charger. The cache's `last_seen_at`
          // bumps on every sync iteration regardless of contact, so
          // exposing that one would lie to the client.
          lastSeenAt: toIso(r.last_status_at),
          capabilities: Array.from(caps),
        };
      });

    const body: ChargersListResponse = { chargers };
    return jsonResponse(200, body);
  },
});
