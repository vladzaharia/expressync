import { inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { lagoPlans } from "../../db/schema.ts";
import { lagoClient } from "../../lib/lago-client.ts";
import type { LagoPlan } from "../../lib/types/lago.ts";
import {
  findOrphans,
  parseLagoTimestamp,
  type ReconcileError,
  type ReconcileResult,
} from "./util.ts";

export async function reconcileLagoPlans(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  const { plans } = await lagoClient.listPlans();
  let upserted = 0;

  for (const p of plans) {
    try {
      await upsertPlan(p);
      upserted++;
    } catch (err) {
      errors.push({
        lagoId: p.lago_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const freshIds = plans.map((p) => p.lago_id);
  const localActive = await db
    .select({ lagoId: lagoPlans.lagoId })
    .from(lagoPlans)
    .where(isNull(lagoPlans.deletedAt));
  const orphanIds = findOrphans(freshIds, localActive.map((r) => r.lagoId));

  if (orphanIds.length > 0) {
    await db
      .update(lagoPlans)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoPlans.lagoId, orphanIds));
  }

  return {
    entity: "lago_plans",
    fetched: plans.length,
    upserted,
    orphaned: orphanIds.length,
    durationMs: Date.now() - start,
    errors,
  };
}

export async function upsertPlan(p: LagoPlan): Promise<void> {
  const values = {
    lagoId: p.lago_id,
    code: p.code,
    name: p.name ?? null,
    interval: p.interval ?? null,
    amountCents: p.amount_cents ?? null,
    currency: p.amount_currency ?? null,
    payload: p as unknown as Record<string, unknown>,
    lagoUpdatedAt: parseLagoTimestamp(
      (p as { updated_at?: string }).updated_at ?? p.created_at ?? null,
    ),
    syncedAt: new Date(),
    deletedAt: null,
  };
  await db
    .insert(lagoPlans)
    .values(values)
    .onConflictDoUpdate({
      target: lagoPlans.lagoId,
      set: {
        code: values.code,
        name: values.name,
        interval: values.interval,
        amountCents: values.amountCents,
        currency: values.currency,
        payload: values.payload,
        lagoUpdatedAt: values.lagoUpdatedAt,
        syncedAt: values.syncedAt,
        deletedAt: null,
      },
    });
}
