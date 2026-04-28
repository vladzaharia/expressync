/**
 * POST   /api/admin/tag/scan-arm    — arm an admin-link intent
 * DELETE /api/admin/tag/scan-arm    — release it
 *
 * Admin-side arming endpoint for the pre-authorize intercept pipeline.
 * Analogous to `/api/auth/scan-pair` (charger path) but session-gated and
 * stamped with `purpose: "admin-link"` on the verification row, so the
 * scan.intercepted event fans out to admin SSE consumers (the unified
 * `<ScanModal>` and `<ScanFlow>`) rather than the customer login flow.
 *
 * Why a separate endpoint:
 *   - scan-pair is unauthenticated (customer hasn't logged in yet);
 *     scan-arm is admin-only, so the arming model diverges (no rate-
 *     limit theater, no IP-only auth).
 *   - The `purpose` field lets pre-authorize discriminate; an admin
 *     tap at charger CB-A to add a new tag MUST NOT be routable to
 *     the customer login flow even if a customer happens to be
 *     listening on the same charger.
 *
 * Admin session enforcement: `routes/_middleware.ts` already gates
 * `/api/admin/*` to admin-role sessions. This handler only re-reads
 * the user id to stamp it on the row.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { auth } from "../../../../src/lib/auth.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import {
  chargerPairingIdentifier,
  deletePairingRow,
  findArmedChargerPairing,
  generateChargerPairingCode,
  insertChargerPairingRow,
  PAIRING_TTL_SEC,
} from "../../../../src/services/scan-arm.service.ts";

const log = logger.child("AdminScanArm");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

async function requireAdminUserId(req: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export const handler = define.handlers({
  async POST(ctx) {
    const adminUserId = await requireAdminUserId(ctx.req);
    if (!adminUserId) return jsonResponse(401, { error: "unauthorized" });

    let body: { chargeBoxId?: unknown } = {};
    try {
      const raw = await ctx.req.text();
      if (raw.trim() !== "") body = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId.trim()
      : "";
    if (!chargeBoxId) {
      return jsonResponse(400, { error: "chargeBoxId required" });
    }

    // One armed intent per charger at a time (matches scan-pair). Purpose
    // doesn't relax that — admin and customer can't both intercept the
    // same charger simultaneously.
    const existing = await findArmedChargerPairing(chargeBoxId);
    if (existing) {
      return jsonResponse(409, { error: "already_armed_for_charger" });
    }

    const pairingCode = generateChargerPairingCode();
    const ip = getClientIp(ctx.req);
    const ua = ctx.req.headers.get("user-agent") ?? null;

    let expiresAt: Date;
    try {
      expiresAt = await insertChargerPairingRow({
        chargeBoxId,
        pairingCode,
        ip,
        ua,
        purpose: "admin-link",
        adminUserId,
      });
    } catch (err) {
      log.error("Failed to insert admin-link intent", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    return jsonResponse(200, {
      pairingCode,
      chargeBoxId,
      expiresInSec: PAIRING_TTL_SEC,
      expiresAtEpochMs: expiresAt.getTime(),
      purpose: "admin-link",
    });
  },

  async DELETE(ctx) {
    const adminUserId = await requireAdminUserId(ctx.req);
    if (!adminUserId) return jsonResponse(401, { error: "unauthorized" });

    let body: { chargeBoxId?: unknown; pairingCode?: unknown } = {};
    try {
      const raw = await ctx.req.text();
      if (raw.trim() !== "") body = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId.trim()
      : "";
    const pairingCode = typeof body.pairingCode === "string"
      ? body.pairingCode.trim()
      : "";
    if (!chargeBoxId || !pairingCode) {
      return jsonResponse(400, {
        error: "chargeBoxId and pairingCode required",
      });
    }
    const identifier = chargerPairingIdentifier(chargeBoxId, pairingCode);
    try {
      await deletePairingRow(identifier);
    } catch (err) {
      log.warn("Failed to release admin-link intent", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return new Response(null, { status: 204 });
  },
});

void sql;
