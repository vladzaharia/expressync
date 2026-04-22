import { define } from "../../../utils.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import {
  dispatch,
  persistWebhookEvent,
} from "../../../src/services/lago-webhook-handler.service.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { verifyLagoSignature } from "../../../src/lib/utils/lago-signature.ts";

const webhookLogger = logger.child("LagoWebhook");

/**
 * Public-key cache for webhook signature verification.
 *
 * Lago's webhook key can rotate (e.g. organization re-provision); we refetch
 * every hour and on verify failure. The cache survives the handler closure.
 */
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000;
let cachedPublicKey: { pem: string; fetchedAt: number } | null = null;

async function getPublicKey(forceRefresh = false): Promise<string | null> {
  const now = Date.now();
  if (
    !forceRefresh && cachedPublicKey &&
    now - cachedPublicKey.fetchedAt < PUBLIC_KEY_TTL_MS
  ) {
    return cachedPublicKey.pem;
  }
  try {
    const pem = await lagoClient.getWebhookPublicKey();
    cachedPublicKey = { pem, fetchedAt: now };
    return pem;
  } catch (err) {
    webhookLogger.error("Failed to fetch Lago webhook public key", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * POST /api/webhook/lago
 *
 * Public endpoint that receives Lago webhook events.
 *
 * Two-phase contract:
 *   1. Persist the raw payload to `lago_webhook_events` FIRST (append-only
 *      audit) so we never lose data even if dispatch throws.
 *   2. Dispatch to the discriminated-union handler. Errors are recorded on
 *      the audit row via `processing_error`.
 *
 * ALWAYS returns 200, even on error. Non-200 would cause Lago to retry, which
 * would duplicate events in the audit table.
 */
export const handler = define.handlers({
  async POST(ctx) {
    // Read raw body FIRST so we can verify the signature against the bytes
    // Lago actually signed, then parse JSON for the handler.
    let raw: string;
    try {
      raw = await ctx.req.text();
    } catch (err) {
      webhookLogger.error("Failed to read webhook body", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ received: true, error: "body_read_failed" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const signature = ctx.req.headers.get("x-lago-signature");
    if (!signature) {
      webhookLogger.warn("Webhook missing X-Lago-Signature header; rejecting");
      return new Response(
        JSON.stringify({ received: false, error: "missing_signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Verify signature. On failure, refresh the public key once (in case Lago
    // rotated) and retry; still-failing means reject with 401.
    let pem = await getPublicKey();
    let verified = pem ? await verifyLagoSignature(signature, pem) : false;
    if (!verified) {
      pem = await getPublicKey(true);
      verified = pem ? await verifyLagoSignature(signature, pem) : false;
    }
    if (!verified) {
      webhookLogger.error("Webhook signature verification failed");
      return new Response(
        JSON.stringify({ received: false, error: "invalid_signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: unknown;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch (err) {
      webhookLogger.error("Failed to parse webhook JSON", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ received: true, error: "invalid_json" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const webhookType = (body as { webhook_type?: unknown } | null)
      ?.webhook_type;
    webhookLogger.info("Webhook received", {
      webhookType: typeof webhookType === "string" ? webhookType : "unknown",
      objectType: (body as { object_type?: unknown } | null)?.object_type,
    });

    // Phase 1: persist FIRST, so we never drop data even on downstream failure.
    let rowId: number;
    try {
      rowId = await persistWebhookEvent(body);
    } catch (err) {
      // Failing to persist is a real problem but we still must 200 to Lago.
      webhookLogger.error("Failed to persist webhook event", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ received: true, error: "persist_failed" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Phase 2: dispatch — wraps errors internally and updates the audit row.
    try {
      await dispatch(body, rowId);
    } catch (err) {
      // `dispatch` already records `processing_error` internally; belt-and-
      // suspenders log here too.
      webhookLogger.error("Webhook dispatch failed (unhandled)", {
        rowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return new Response(
      JSON.stringify({ received: true, row_id: rowId }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
});
