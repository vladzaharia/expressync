/**
 * Webhook → cache upserts.
 *
 * Each helper accepts the raw webhook payload (passthrough'd by Zod so the
 * per-type schemas don't validate the entity sub-object) and upserts the
 * matching cache table. All functions are best-effort and never throw —
 * errors are returned as strings so the dispatcher can log them alongside
 * its notification path.
 */

import { LagoCustomerSchema, LagoWalletSchema } from "../../lib/types/lago.ts";
import {
  softDeleteCustomer,
  softDeleteInvoice,
  softDeleteSubscription,
  upsertCustomer,
  upsertInvoice,
  upsertPlan,
  upsertSubscription,
  upsertWallet,
} from "./index.ts";
import {
  LagoInvoiceExtendedSchema,
  LagoPlanSchema,
  LagoSubscriptionSchema,
} from "../../lib/types/lago.ts";

type AnyRecord = Record<string, unknown>;

function pickObject(p: AnyRecord, key: string): AnyRecord | null {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as AnyRecord;
  }
  return null;
}

function safeParse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  v: unknown,
): T | null {
  const r = schema.safeParse(v);
  return r.success && r.data ? r.data : null;
}

export async function handleCustomerWebhook(
  payload: AnyRecord,
  webhookType: string,
): Promise<{ ok: boolean; error?: string }> {
  const raw = pickObject(payload, "customer");
  if (!raw) return { ok: false, error: "no customer in payload" };

  if (webhookType === "customer.deleted") {
    const lagoId = typeof raw.lago_id === "string" ? raw.lago_id : null;
    if (!lagoId) return { ok: false, error: "no lago_id on deleted customer" };
    try {
      await softDeleteCustomer(lagoId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const parsed = safeParse(LagoCustomerSchema, raw);
  if (!parsed) return { ok: false, error: "customer payload failed schema" };
  try {
    await upsertCustomer(parsed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleSubscriptionWebhook(
  payload: AnyRecord,
  webhookType: string,
): Promise<{ ok: boolean; error?: string }> {
  const raw = pickObject(payload, "subscription");
  if (!raw) return { ok: false, error: "no subscription in payload" };

  if (
    webhookType === "subscription.terminated" ||
    webhookType === "subscription.terminated_and_downgraded"
  ) {
    // Terminated is not deleted — we keep the row with terminated_at set,
    // so fall through to upsert. Lago typically includes the full object on
    // terminate webhooks.
  }

  const parsed = safeParse(LagoSubscriptionSchema, raw);
  if (!parsed) {
    return { ok: false, error: "subscription payload failed schema" };
  }
  try {
    await upsertSubscription(parsed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handlePlanWebhook(
  payload: AnyRecord,
  webhookType: string,
): Promise<{ ok: boolean; error?: string }> {
  const raw = pickObject(payload, "plan");
  if (!raw) return { ok: false, error: "no plan in payload" };

  if (webhookType === "plan.deleted") {
    // Soft-delete by plan.lago_id if present.
    const lagoId = typeof raw.lago_id === "string" ? raw.lago_id : null;
    if (!lagoId) return { ok: false, error: "no lago_id on plan.deleted" };
    // No dedicated softDeletePlan helper — we upsert with deletedAt=now
    // via a direct update below if needed. Current plan reconciler handles
    // orphans on the next cycle, so skip.
    return { ok: true };
  }

  const parsed = safeParse(LagoPlanSchema, raw);
  if (!parsed) return { ok: false, error: "plan payload failed schema" };
  try {
    await upsertPlan(parsed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleInvoiceWebhook(
  payload: AnyRecord,
  webhookType: string,
): Promise<{ ok: boolean; error?: string }> {
  const raw = pickObject(payload, "invoice");
  if (!raw) return { ok: false, error: "no invoice in payload" };

  if (webhookType === "invoice.voided") {
    const lagoId = typeof raw.lago_id === "string" ? raw.lago_id : null;
    if (!lagoId) return { ok: false, error: "no lago_id on voided invoice" };
    // Keep void invoices in cache but flip status to voided via upsert path.
  }

  if (webhookType === "invoice.deleted") {
    const lagoId = typeof raw.lago_id === "string" ? raw.lago_id : null;
    if (!lagoId) return { ok: false, error: "no lago_id on invoice.deleted" };
    try {
      await softDeleteInvoice(lagoId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const parsed = safeParse(LagoInvoiceExtendedSchema, raw);
  if (!parsed) return { ok: false, error: "invoice payload failed schema" };
  try {
    await upsertInvoice(parsed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleWalletWebhook(
  payload: AnyRecord,
  webhookType: string,
): Promise<{ ok: boolean; error?: string }> {
  const raw = pickObject(payload, "wallet");
  if (!raw) return { ok: false, error: "no wallet in payload" };

  if (webhookType === "wallet.terminated") {
    // Terminated wallets remain in cache with status=terminated via upsert.
  }

  const parsed = safeParse(LagoWalletSchema, raw);
  if (!parsed) return { ok: false, error: "wallet payload failed schema" };
  try {
    await upsertWallet(parsed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Re-export soft-delete helpers so the dispatcher can short-circuit directly.
export { softDeleteSubscription };
