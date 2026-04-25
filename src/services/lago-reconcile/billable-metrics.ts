import { inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { lagoBillableMetrics } from "../../db/schema.ts";
import { lagoClient } from "../../lib/lago-client.ts";
import type { LagoBillableMetric } from "../../lib/types/lago.ts";
import {
  findOrphans,
  type ReconcileError,
  type ReconcileResult,
} from "./util.ts";

export async function reconcileLagoBillableMetrics(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  const { billable_metrics } = await lagoClient.listBillableMetrics();
  let upserted = 0;

  for (const m of billable_metrics) {
    if (!m.lago_id) continue; // schema has lago_id optional; skip ids-less
    try {
      await upsertBillableMetric(m);
      upserted++;
    } catch (err) {
      errors.push({
        lagoId: m.lago_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const freshIds = billable_metrics
    .map((m) => m.lago_id)
    .filter((id): id is string => typeof id === "string");
  const localActive = await db
    .select({ lagoId: lagoBillableMetrics.lagoId })
    .from(lagoBillableMetrics)
    .where(isNull(lagoBillableMetrics.deletedAt));
  const orphanIds = findOrphans(freshIds, localActive.map((r) => r.lagoId));

  if (orphanIds.length > 0) {
    await db
      .update(lagoBillableMetrics)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoBillableMetrics.lagoId, orphanIds));
  }

  return {
    entity: "lago_billable_metrics",
    fetched: billable_metrics.length,
    upserted,
    orphaned: orphanIds.length,
    durationMs: Date.now() - start,
    errors,
  };
}

async function upsertBillableMetric(m: LagoBillableMetric): Promise<void> {
  if (!m.lago_id) return;
  const values = {
    lagoId: m.lago_id,
    code: m.code,
    name: m.name ?? null,
    aggregationType: m.aggregation_type ?? null,
    fieldName: m.field_name ?? null,
    recurring: m.recurring ?? null,
    payload: m as unknown as Record<string, unknown>,
    syncedAt: new Date(),
    deletedAt: null,
  };
  await db
    .insert(lagoBillableMetrics)
    .values(values)
    .onConflictDoUpdate({
      target: lagoBillableMetrics.lagoId,
      set: {
        code: values.code,
        name: values.name,
        aggregationType: values.aggregationType,
        fieldName: values.fieldName,
        recurring: values.recurring,
        payload: values.payload,
        syncedAt: values.syncedAt,
        deletedAt: null,
      },
    });
}
