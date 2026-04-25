import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { lagoSubscriptions } from "../../db/schema.ts";
import { lagoClient } from "../../lib/lago-client.ts";
import type { LagoSubscription } from "../../lib/types/lago.ts";
import {
  findOrphans,
  parseLagoTimestamp,
  type ReconcileError,
  type ReconcileResult,
} from "./util.ts";

export async function reconcileLagoSubscriptions(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  const { subscriptions } = await lagoClient.getSubscriptions();
  let upserted = 0;

  for (const s of subscriptions) {
    try {
      await upsertSubscription(s);
      upserted++;
    } catch (err) {
      errors.push({
        lagoId: s.lago_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const freshIds = subscriptions.map((s) => s.lago_id);
  const localActive = await db
    .select({ lagoId: lagoSubscriptions.lagoId })
    .from(lagoSubscriptions)
    .where(isNull(lagoSubscriptions.deletedAt));
  const orphanIds = findOrphans(freshIds, localActive.map((r) => r.lagoId));

  if (orphanIds.length > 0) {
    await db
      .update(lagoSubscriptions)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoSubscriptions.lagoId, orphanIds));
  }

  return {
    entity: "lago_subscriptions",
    fetched: subscriptions.length,
    upserted,
    orphaned: orphanIds.length,
    durationMs: Date.now() - start,
    errors,
  };
}

export async function upsertSubscription(
  s: LagoSubscription,
): Promise<void> {
  const values = {
    lagoId: s.lago_id,
    externalId: s.external_id,
    externalCustomerId: s.external_customer_id ?? null,
    customerLagoId: s.lago_customer_id ?? null,
    planCode: s.plan_code ?? null,
    status: s.status ?? null,
    startedAt: parseLagoTimestamp(s.started_at),
    terminatedAt: parseLagoTimestamp(s.terminated_at),
    payload: s as unknown as Record<string, unknown>,
    lagoUpdatedAt: parseLagoTimestamp(s.created_at),
    syncedAt: new Date(),
    deletedAt: null,
  };
  await db
    .insert(lagoSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: lagoSubscriptions.lagoId,
      set: {
        externalId: values.externalId,
        externalCustomerId: values.externalCustomerId,
        customerLagoId: values.customerLagoId,
        planCode: values.planCode,
        status: values.status,
        startedAt: values.startedAt,
        terminatedAt: values.terminatedAt,
        payload: values.payload,
        lagoUpdatedAt: values.lagoUpdatedAt,
        syncedAt: values.syncedAt,
        deletedAt: null,
      },
    });
}

export async function softDeleteSubscription(lagoId: string): Promise<void> {
  await db
    .update(lagoSubscriptions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(lagoSubscriptions.lagoId, lagoId),
        isNull(lagoSubscriptions.deletedAt),
      ),
    );
}
