/**
 * GET /api/devices/scan-result/{pairingCode}
 *
 * ExpresScan / Wave 3 Track C-result — polling fallback for an enriched
 * scan result the device has already submitted via POST. iOS uses this on
 * a brief poll loop when the foreground POST request fails (network blip,
 * app backgrounded, etc.) — the verifications row keeps `status='consumed'`
 * + `matchedIdTag` for ~30s after consume so the iPhone can recover the
 * payload without re-prompting the user.
 *
 * Auth: bearer (`ctx.state.device` from Track A's `resolveBearer`). The
 * pairingCode in the URL is treated as a target identifier, not a secret —
 * it's single-use and 90s-TTL'd at arm time.
 *
 * Response shape:
 *   - 200 + EnrichedScanResult — pairing was consumed and we have a
 *                                stored idTag.
 *   - 202 { status: "pending" } — pairing exists but is still `armed`
 *                                 (the device hasn't finished POSTing).
 *   - 401 — bearer missing / invalid.
 *   - 404 — no row for the (deviceId, pairingCode) tuple. Includes the
 *           "row was already cleaned up by the rate-limit cron" case.
 *
 * The row is owned by `(deviceId, pairingCode)`: even with a valid bearer,
 * we never serve a result for a pairing that wasn't armed against THIS
 * device. That's the device-scoping equivalent of the charger flow's
 * chargeBoxId binding.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { enrichByIdTag } from "../../../../src/services/device-enrichment.service.ts";
import type { EnrichedScanResult } from "../../../../src/lib/types/devices.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceScanResultPoll");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Shape stored in the `verifications.value` JSON for an armed (then
 * consumed) device-scan row. Written by the scan-arm endpoint and updated
 * by the POST scan-result handler. Defensive: every field optional except
 * `status`.
 */
interface DeviceScanRowValue {
  status?: "armed" | "consumed";
  /** Hex-uppercase idTag the device reported on consume. */
  matchedIdTag?: string;
  /** Original pairing purpose. */
  purpose?: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const device = ctx.state.device;
    if (!device) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    const deviceId = device.id;

    const pairingCode = ctx.params.pairingCode ?? "";
    if (!pairingCode || typeof pairingCode !== "string") {
      // Defensive — Fresh wires the param through; an empty value means
      // a routing oddity. Return 404 (the contract has no 400 here).
      return jsonResponse(404, { error: "not_found" });
    }

    // Look up the row. We DON'T filter by `expires_at` — a consumed row
    // may have ticked past its arm-time TTL but still be useful for a
    // poll; the rate-limit cleanup cron will GC it eventually.
    const identifier = `device-scan:${deviceId}:${pairingCode}`;
    let row:
      | { value: unknown; expiresAt: Date | string | null }
      | undefined;
    try {
      const result = await db.execute<
        { value: unknown; expires_at: Date | string | null }
      >(sql`
        SELECT value::jsonb AS value, expires_at
        FROM verifications
        WHERE identifier = ${identifier}
        LIMIT 1
      `);
      const rows = (Array.isArray(result) ? result : (result as {
        rows?: { value: unknown; expires_at: Date | string | null }[];
      }).rows ?? []) as {
        value: unknown;
        expires_at: Date | string | null;
      }[];
      if (rows.length === 1) {
        row = { value: rows[0].value, expiresAt: rows[0].expires_at };
      }
    } catch (err) {
      log.error("Verifications lookup failed", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    if (!row) {
      return jsonResponse(404, { error: "not_found" });
    }

    const value = (row.value ?? {}) as DeviceScanRowValue;
    const status = value.status;

    if (status === "armed") {
      // Pairing exists, scan hasn't been completed yet. 202 lets the
      // poll-loop know to keep waiting.
      return jsonResponse(202, { status: "pending" });
    }

    if (status === "consumed") {
      const matchedIdTag = typeof value.matchedIdTag === "string"
        ? value.matchedIdTag.toUpperCase()
        : null;

      if (!matchedIdTag) {
        // Consumed but we lost the idTag (legacy row, race during
        // commit). Treat as gone — better than half-rendering.
        return jsonResponse(404, { error: "not_found" });
      }

      const enriched = await enrichByIdTag(matchedIdTag);
      const responseBody: EnrichedScanResult = {
        ok: true,
        found: enriched.found,
        pairingCode,
        idTag: matchedIdTag,
        resolvedAtIso: new Date().toISOString(),
        tag: enriched.tag,
        customer: enriched.customer,
        subscription: enriched.subscription,
      };
      return jsonResponse(200, responseBody);
    }

    // Unknown / missing status → treat as gone.
    return jsonResponse(404, { error: "not_found" });
  },
});
