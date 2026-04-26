/**
 * POST /api/ocpp/pre-authorize
 *
 * Pre-Authorize hook target for the SteVe fork
 * (see /docker/services/ocpp/src/main/java/de/rwth/idsg/steve/service/
 * HttpPreAuthorizeHook.java). Called synchronously by SteVe from inside
 * `OcppTagService.getIdTagInfo(...)` on every Authorize.req AND on every
 * StartTransaction.req, before SteVe responds to the charger. SteVe's
 * budget is ~200ms; anything slower fails open and the charger proceeds
 * with the default decision.
 *
 * Request body (JSON):
 *   { idTag, chargeBoxId, connectorId, isStartTx, ts }
 *
 * Request header:
 *   X-Signature: <hex HMAC-SHA256(STEVE_PREAUTH_HMAC_KEY, raw body)>
 *
 * Response body:
 *   { override: "BLOCKED" | null }
 *
 * Semantics:
 *   - When an armed `scan-pair:{chargeBoxId}:*` row exists (the same row
 *     created by POST /api/auth/scan-pair), we "steal" the scan for the
 *     scan-to-login flow:
 *       1. Atomically transition the row to status=matched with matchedIdTag.
 *       2. Publish a `scan.intercepted` event so scan-detect's SSE stream
 *          forwards to the waiting customer.
 *       3. Return {override: "BLOCKED"} so SteVe rewrites the IdTagInfo
 *          status from ACCEPTED -> BLOCKED. The charger must not start a
 *          transaction on BLOCKED.
 *   - Otherwise return {override: null} so SteVe returns its normal status.
 *
 * Fail-open invariants (charging must never break because ExpresSync is
 * down):
 *   - 503 when the feature flag is off.
 *   - 401 on HMAC mismatch. SteVe treats any non-2xx as "no override" —
 *     we log and move on.
 *   - 500 on DB error. Same — SteVe falls through. Never 500 silently.
 *
 * Idempotency:
 *   - If SteVe retries for the same (chargeBoxId, idTag) against an
 *     already-matched row where matchedIdTag matches, we still return
 *     {override: "BLOCKED"} (same scan, same decision). A mismatched
 *     matchedIdTag returns {override: null} so a second tag tapped at
 *     the same charger during the window is NOT hijacked.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { config } from "../../../src/lib/config.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("PreAuthorize");

const _enc = new TextEncoder();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let cachedHmacKey: CryptoKey | null = null;
async function getHmacKey(): Promise<CryptoKey | null> {
  if (!config.STEVE_PREAUTH_HMAC_KEY) return null;
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = await crypto.subtle.importKey(
    "raw",
    _enc.encode(config.STEVE_PREAUTH_HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return cachedHmacKey;
}

function hexDecode(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

interface HookBody {
  idTag?: string;
  chargeBoxId?: string;
  connectorId?: number;
  isStartTx?: boolean;
  ts?: number;
}

export const handler = define.handlers({
  async POST(ctx) {
    // Read the raw body so HMAC verification matches what SteVe signed.
    let raw: string;
    try {
      raw = await ctx.req.text();
    } catch {
      return jsonResponse(400, { error: "invalid_body" });
    }

    const sigHex = ctx.req.headers.get("x-signature") ?? "";
    const key = await getHmacKey();
    if (!key || !sigHex) {
      // Fail-closed on HMAC: reject so SteVe logs the warning and fails open
      // at its end. We don't publish any event or mutate state.
      log.warn("Missing HMAC key or signature", {
        hasKey: Boolean(key),
        hasSig: Boolean(sigHex),
      });
      return jsonResponse(401, { error: "unauthorized" });
    }
    const sigBytes = hexDecode(sigHex);
    if (!sigBytes) return jsonResponse(401, { error: "unauthorized" });
    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        "HMAC",
        key,
        sigBytes.buffer.slice(
          sigBytes.byteOffset,
          sigBytes.byteOffset + sigBytes.byteLength,
        ) as ArrayBuffer,
        _enc.encode(raw),
      );
    } catch (err) {
      log.error("HMAC verify threw", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!valid) return jsonResponse(401, { error: "unauthorized" });

    let body: HookBody;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const idTag = typeof body.idTag === "string" ? body.idTag.trim() : "";
    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId.trim()
      : "";
    if (!idTag || !chargeBoxId) {
      return jsonResponse(400, { error: "invalid_body" });
    }

    // Atomic "steal": transition one armed scan-pair row for this charger
    // to matched. The UPDATE only fires when the row is still armed, OR
    // already matched to the SAME idTag (idempotent replay). A row matched
    // to a different idTag is left alone so a second tap by a different
    // tag during the window charges normally.
    //
    // We read `purpose` from the row's value JSON and forward it on the
    // scan.intercepted event so the hook serves known + unknown tags
    // uniformly while downstream routes (scan-login, admin-link, etc.)
    // decide their own semantics.
    let rows: {
      id: string;
      pairing_code: string;
      purpose: string | null;
      was_armed: boolean;
    }[];
    try {
      const result = await db.execute<{
        id: string;
        pairing_code: string;
        purpose: string | null;
        was_armed: boolean;
      }>(sql`
        WITH target AS (
          SELECT id, identifier, value
          FROM verifications
          WHERE identifier LIKE ${`scan-pair:${chargeBoxId}:%`}
            AND expires_at > now()
            AND (
              value::jsonb->>'status' = 'armed'
              OR (
                value::jsonb->>'status' = 'matched'
                AND value::jsonb->>'matchedIdTag' = ${idTag}
              )
            )
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE verifications v
        SET value = jsonb_set(
                      jsonb_set(
                        v.value::jsonb,
                        '{status}', '"matched"'
                      ),
                      '{matchedIdTag}', to_jsonb(${idTag}::text)
                    )::text,
            updated_at = now()
        FROM target
        WHERE v.id = target.id
        RETURNING
          v.id,
          split_part(v.identifier, ':', 3) AS pairing_code,
          target.value::jsonb->>'purpose' AS purpose,
          (target.value::jsonb->>'status' = 'armed') AS was_armed
      `);
      rows = (Array.isArray(result)
        ? result
        : (result as { rows?: unknown[] }).rows ?? []) as {
          id: string;
          pairing_code: string;
          purpose: string | null;
          was_armed: boolean;
        }[];
    } catch (err) {
      log.error("Failed atomic steal-or-match", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-open: SteVe must not break on our DB outage.
      return jsonResponse(500, { error: "internal" });
    }

    if (rows.length === 0) {
      // No armed intent for this charger — let SteVe do its thing.
      return jsonResponse(200, { override: null });
    }

    const row = rows[0];
    // Only publish the SSE fan-out on a FRESH match (row was armed before
    // this call). Idempotent replays of the same idTag on an already-
    // matched row skip the publish but still return the override so the
    // charger keeps getting BLOCKED on retries.
    if (row.was_armed) {
      try {
        eventBus.publish({
          type: "scan.intercepted",
          payload: {
            idTag,
            // Wave 1 Track A: payload is generalized — chargers send
            // pairableType:"charger" with pairableId=chargeBoxId.
            pairableType: "charger",
            pairableId: chargeBoxId,
            pairingCode: row.pairing_code,
            purpose: row.purpose ?? "login",
            t: Date.now(),
            source: "ocpp-preauth",
          },
        });
      } catch (err) {
        // Publishing is best-effort; the match is durable in the DB.
        log.warn("Failed to publish scan.intercepted", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return jsonResponse(200, { override: "BLOCKED" });
  },
});
