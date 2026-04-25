/**
 * POST   /api/admin/tag/scan-arm    — arm an admin-link intent
 * DELETE /api/admin/tag/scan-arm    — release it
 *
 * Admin-side arming endpoint for the pre-authorize intercept pipeline.
 * Analogous to `/api/auth/scan-pair` but session-gated to admins and
 * stamped with `purpose: "admin-link"` on the verification row, so the
 * scan.intercepted event fans out to admin SSE consumers (TapToAddModal,
 * ScanTagAction) rather than the customer login flow.
 *
 * Why a separate endpoint:
 *   - scan-pair is unauthenticated (the whole point — user can't log in
 *     yet). scan-arm is only usable by an already-authenticated admin, so
 *     the arming model diverges: no rate-limit theater, no IP-only auth.
 *   - The `purpose` field lets consumers discriminate; an admin tap at
 *     charger CB-A to add a new tag MUST NOT be routable to the customer
 *     login flow even if a customer happens to be listening there.
 *
 * Design mirrors scan-pair's semantics:
 *   identifier = "scan-pair:{chargeBoxId}:{pairingCode}"
 *   value      = {chargeBoxId, status:"armed", purpose:"admin-link",
 *                 adminUserId, ua, ip}
 *   expiresAt  = now + 90s
 * One armed row per charger — 409 on conflict.
 *
 * Admin session enforcement: the root middleware already gates
 * `/api/admin/*` to admin-role sessions (see routes/_middleware.ts). This
 * handler only re-reads the user id to stamp it on the row.
 */

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { verifications } from "../../../../src/db/schema.ts";
import { auth } from "../../../../src/lib/auth.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminScanArm");

const PAIRING_TTL_SEC = 90;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePairingCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
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

    // One armed intent per charger at a time, same as scan-pair. Purpose
    // doesn't relax that — an admin and a customer can't both be
    // intercepting the same charger simultaneously.
    try {
      const existing = await db.execute<{ id: string }>(sql`
        SELECT id FROM verifications
        WHERE identifier LIKE ${`scan-pair:${chargeBoxId}:%`}
          AND expires_at > now()
          AND value::jsonb->>'status' = 'armed'
        LIMIT 1
      `);
      const list = Array.isArray(existing)
        ? existing
        : (existing as { rows?: unknown[] }).rows ?? [];
      if (list.length > 0) {
        return jsonResponse(409, { error: "already_armed_for_charger" });
      }
    } catch (err) {
      log.warn("Armed precheck failed; continuing", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const pairingCode = generatePairingCode();
    const identifier = `scan-pair:${chargeBoxId}:${pairingCode}`;
    const ip = getClientIp(ctx.req);
    const ua = ctx.req.headers.get("user-agent") ?? null;
    const value = JSON.stringify({
      chargeBoxId,
      ip,
      ua,
      status: "armed",
      purpose: "admin-link",
      adminUserId,
    });
    const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000);

    try {
      await db.insert(verifications).values({
        id: crypto.randomUUID(),
        identifier,
        value,
        expiresAt,
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
    const identifier = `scan-pair:${chargeBoxId}:${pairingCode}`;
    try {
      await db.delete(verifications).where(
        eq(verifications.identifier, identifier),
      );
    } catch (err) {
      log.warn("Failed to release admin-link intent", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return new Response(null, { status: 204 });
  },
});
