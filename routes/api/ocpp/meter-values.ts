/**
 * POST /api/ocpp/meter-values
 *
 * Live MeterValues hook target for the SteVe fork. Mirrors the HMAC-signed
 * pattern of `pre-authorize.ts` (see HttpPreAuthorizeHook.java); the SteVe
 * counterpart is `HttpMeterValueHook.java`, dispatched asynchronously from
 * `CentralSystemService16_Service.meterValues()` so it never blocks the
 * OCPP response.
 *
 * Request body (JSON):
 *   {
 *     chargeBoxId: string,
 *     transactionPk: number,
 *     connectorId: number,
 *     timestamp: string,           // ISO-8601 of the MeterValue
 *     samples: Array<{
 *       value: string,             // numeric reading, OCPP keeps it as a string
 *       measurand?: string,        // e.g. "Energy.Active.Import.Register", "Power.Active.Import"
 *       unit?: string,             // e.g. "Wh", "kWh", "W", "kW"
 *       context?: string,          // "Sample.Periodic", "Transaction.Begin", "Transaction.End", ...
 *       phase?: string,
 *       location?: string,
 *     }>
 *   }
 *
 * Request header:
 *   X-Signature: <hex HMAC-SHA256(STEVE_METERVALUE_HMAC_KEY, raw body)>
 *
 * Response: 200 always (best-effort, fire-and-forget on the SteVe side).
 *
 * Fail-open: invalid signatures, unknown transactions, and DB outages all
 * log + return non-fatal status codes. Charging must never break because
 * ExpresSync can't keep up with meter values.
 */

import { eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { config } from "../../../src/lib/config.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";
import { enqueueMeterSample } from "../../../src/services/incremental-billing.service.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("MeterValues");
const _enc = new TextEncoder();

interface SampledValue {
  value: string;
  measurand?: string;
  unit?: string;
  context?: string;
  phase?: string;
  location?: string;
}

interface HookBody {
  chargeBoxId?: string;
  transactionPk?: number;
  connectorId?: number;
  timestamp?: string;
  samples?: SampledValue[];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let cachedHmacKey: CryptoKey | null = null;
async function getHmacKey(): Promise<CryptoKey | null> {
  if (!config.STEVE_METERVALUE_HMAC_KEY) return null;
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = await crypto.subtle.importKey(
    "raw",
    _enc.encode(config.STEVE_METERVALUE_HMAC_KEY),
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

/**
 * Pick the cumulative energy reading (kWh) from a MeterValues sample list.
 * OCPP 1.6 chargers may report Wh, kWh, varh, etc. with the unit on each
 * sample. Defaults to `Energy.Active.Import.Register` / Wh when the measurand
 * or unit is omitted (the OCPP spec defaults).
 */
function extractEnergyKwh(samples: SampledValue[]): number | null {
  for (const s of samples) {
    const measurand = s.measurand ?? "Energy.Active.Import.Register";
    if (measurand !== "Energy.Active.Import.Register") continue;
    const n = Number(s.value);
    if (!Number.isFinite(n)) continue;
    const unit = (s.unit ?? "Wh").toLowerCase();
    switch (unit) {
      case "kwh":
        return n;
      case "wh":
        return n / 1000;
      default:
        // Unknown unit — assume Wh per OCPP default but log so we can spot it.
        log.warn("Unknown energy unit; assuming Wh", { unit, value: s.value });
        return n / 1000;
    }
  }
  return null;
}

/**
 * Pick instantaneous power (kW) if the charger reports it. Some chargers
 * emit Power.Active.Import per phase; sum them when multiple phases appear.
 * Returns null when the charger doesn't report power (the LiveSessionCard
 * falls back to a kWh-delta rolling average client-side).
 */
function extractPowerKw(samples: SampledValue[]): number | null {
  let total = 0;
  let any = false;
  for (const s of samples) {
    if (s.measurand !== "Power.Active.Import") continue;
    const n = Number(s.value);
    if (!Number.isFinite(n)) continue;
    const unit = (s.unit ?? "W").toLowerCase();
    total += unit === "kw" ? n : n / 1000;
    any = true;
  }
  return any ? total : null;
}

/** True when the sample carries a stop-of-transaction context. */
function isFinalSample(samples: SampledValue[]): boolean {
  return samples.some((s) => s.context === "Transaction.End");
}

// ---------------------------------------------------------------------------
// Mapping resolution: transactionPk → userMappingId
// ---------------------------------------------------------------------------
// Cached for the lifetime of the process. A transaction in StEvE is uniquely
// identified by `transactionPk`; once we've resolved its idTag and matched
// it to a user_mappings row, the answer doesn't change for the duration of
// the session. Bounded with a soft cap so a long-running process doesn't
// retain unbounded entries; LRU-ish via insertion order eviction.

const MAPPING_CACHE_MAX = 1024;
const mappingCache = new Map<number, number | null>();

function rememberMapping(transactionPk: number, mappingId: number | null) {
  if (mappingCache.size >= MAPPING_CACHE_MAX) {
    // Drop the oldest entry — Map preserves insertion order.
    const oldest = mappingCache.keys().next().value;
    if (oldest !== undefined) mappingCache.delete(oldest);
  }
  mappingCache.set(transactionPk, mappingId);
}

async function resolveUserMappingId(
  transactionPk: number,
): Promise<number | null> {
  if (mappingCache.has(transactionPk)) {
    return mappingCache.get(transactionPk) ?? null;
  }
  // Look up the transaction's idTag from StEvE, then resolve to a mapping.
  let idTag: string | null = null;
  try {
    const txs = await steveClient.getTransactions({ transactionPk });
    if (txs.length > 0) {
      idTag = txs[0].ocppIdTag ?? null;
    }
  } catch (err) {
    log.warn("StEvE transaction lookup failed; cannot resolve mapping", {
      transactionPk,
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't cache the negative — transient StEvE outage shouldn't poison
    // future lookups.
    return null;
  }
  if (!idTag) {
    rememberMapping(transactionPk, null);
    return null;
  }
  try {
    const [row] = await db
      .select({ id: schema.userMappings.id })
      .from(schema.userMappings)
      .where(eq(schema.userMappings.steveOcppIdTag, idTag))
      .limit(1);
    const mappingId = row?.id ?? null;
    rememberMapping(transactionPk, mappingId);
    return mappingId;
  } catch (err) {
    log.warn("user_mappings lookup failed", {
      transactionPk,
      idTag,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const handler = define.handlers({
  async POST(ctx) {
    let raw: string;
    try {
      raw = await ctx.req.text();
    } catch {
      return jsonResponse(400, { error: "invalid_body" });
    }

    const sigHex = ctx.req.headers.get("x-signature") ?? "";
    const key = await getHmacKey();
    if (!key || !sigHex) {
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

    const chargeBoxId = typeof body.chargeBoxId === "string"
      ? body.chargeBoxId.trim()
      : "";
    const transactionPk = typeof body.transactionPk === "number"
      ? body.transactionPk
      : NaN;
    const samples = Array.isArray(body.samples) ? body.samples : [];
    if (
      !chargeBoxId || !Number.isFinite(transactionPk) || samples.length === 0
    ) {
      // Bad payload — ack quickly so SteVe doesn't retry uselessly.
      return jsonResponse(400, { error: "invalid_body" });
    }

    const kwh = extractEnergyKwh(samples) ?? undefined;
    const powerKw = extractPowerKw(samples) ?? undefined;
    const ended = isFinalSample(samples);

    // Mapping lookup is async + StEvE-bound. Don't block the SteVe response
    // on it: we publish optimistically with `userMappingId` undefined when
    // the resolver is still warming, and the customer SSE filter drops
    // those (fail-closed). The next sample within ~15s carries the cached
    // mapping id and the customer will see the live update.
    const userMappingId = await resolveUserMappingId(transactionPk);

    try {
      eventBus.publish({
        type: "transaction.meter",
        payload: {
          transactionId: transactionPk,
          chargeBoxId,
          kwh,
          powerKw,
          connectorId: typeof body.connectorId === "number"
            ? body.connectorId
            : undefined,
          meterTimestamp: typeof body.timestamp === "string"
            ? body.timestamp
            : undefined,
          userMappingId: userMappingId ?? undefined,
          endedAt: ended
            ? (typeof body.timestamp === "string"
              ? body.timestamp
              : new Date().toISOString())
            : undefined,
        },
      });
    } catch (err) {
      log.warn("eventBus.publish failed", {
        transactionPk,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Hand the sample to the incremental billing emitter. It buffers
    // per-tx kWh deltas and flushes to Lago every ~60s. The post-tx
    // reconciliation sweep in sync.service guarantees correctness even
    // when this path drops samples (e.g. ExpresSync restart loses the
    // in-memory queue).
    try {
      enqueueMeterSample({
        steveTransactionId: transactionPk,
        chargeBoxId,
        kwh: typeof kwh === "number" ? kwh : null,
        meterTimestamp: typeof body.timestamp === "string"
          ? body.timestamp
          : null,
        isFinal: ended,
        userMappingId: userMappingId ?? null,
      });
    } catch (err) {
      // Belt-and-braces: enqueueMeterSample is fully fail-soft internally,
      // but we still wrap so an unexpected throw can't break the OCPP ack.
      log.warn("enqueueMeterSample failed", {
        transactionPk,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return jsonResponse(200, { ok: true });
  },
});

/** Exposed for tests. */
export const _internal = {
  extractEnergyKwh,
  extractPowerKw,
  isFinalSample,
  mappingCache,
  rememberMapping,
};
