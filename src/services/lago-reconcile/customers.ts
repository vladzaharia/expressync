import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { lagoCustomers } from "../../db/schema.ts";
import { lagoClient } from "../../lib/lago-client.ts";
import type { LagoCustomer } from "../../lib/types/lago.ts";
import {
  findOrphans,
  parseLagoTimestamp,
  type ReconcileError,
  type ReconcileResult,
} from "./util.ts";

export async function reconcileLagoCustomers(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  const { customers } = await lagoClient.getCustomers();
  let upserted = 0;

  for (const c of customers) {
    try {
      await upsertCustomer(c);
      upserted++;
    } catch (err) {
      errors.push({
        lagoId: c.lago_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Orphan pass: mark local rows not returned by Lago as deleted. Only
  // considers rows currently non-deleted so repeated runs don't re-stamp
  // deleted_at.
  const freshIds = customers.map((c) => c.lago_id);
  const localActive = await db
    .select({ lagoId: lagoCustomers.lagoId })
    .from(lagoCustomers)
    .where(isNull(lagoCustomers.deletedAt));
  const orphanIds = findOrphans(freshIds, localActive.map((r) => r.lagoId));

  if (orphanIds.length > 0) {
    await db
      .update(lagoCustomers)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoCustomers.lagoId, orphanIds));
  }

  return {
    entity: "lago_customers",
    fetched: customers.length,
    upserted,
    orphaned: orphanIds.length,
    durationMs: Date.now() - start,
    errors,
  };
}

export async function upsertCustomer(c: LagoCustomer): Promise<void> {
  await db
    .insert(lagoCustomers)
    .values({
      lagoId: c.lago_id,
      externalId: c.external_id,
      name: c.name ?? null,
      email: c.email ?? null,
      currency: c.currency ?? null,
      payload: c as unknown as Record<string, unknown>,
      lagoUpdatedAt: parseLagoTimestamp(c.updated_at ?? c.created_at ?? null),
      syncedAt: new Date(),
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: lagoCustomers.lagoId,
      set: {
        externalId: c.external_id,
        name: c.name ?? null,
        email: c.email ?? null,
        currency: c.currency ?? null,
        payload: c as unknown as Record<string, unknown>,
        lagoUpdatedAt: parseLagoTimestamp(c.updated_at ?? c.created_at ?? null),
        syncedAt: new Date(),
        deletedAt: null,
      },
    });
}

/**
 * Soft-mark a customer as deleted (webhook-driven).
 */
export async function softDeleteCustomer(lagoId: string): Promise<void> {
  await db
    .update(lagoCustomers)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(lagoCustomers.lagoId, lagoId), isNull(lagoCustomers.deletedAt)),
    );
}

// Silence unused-import warnings if a future refactor drops one of these.
void sql;
