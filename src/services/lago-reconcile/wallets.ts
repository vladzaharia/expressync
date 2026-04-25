import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { lagoCustomers, lagoWallets } from "../../db/schema.ts";
import { lagoClient } from "../../lib/lago-client.ts";
import type { LagoWallet } from "../../lib/types/lago.ts";
import {
  findOrphans,
  parseLagoTimestamp,
  type ReconcileError,
  type ReconcileResult,
} from "./util.ts";

export async function reconcileLagoWallets(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  // Lago's /wallets endpoint requires external_customer_id, so we iterate
  // known customers (from the cache populated immediately before this step).
  const customers = await db
    .select({ externalId: lagoCustomers.externalId })
    .from(lagoCustomers)
    .where(isNull(lagoCustomers.deletedAt));

  const freshIds = new Set<string>();
  let upserted = 0;
  let fetched = 0;

  for (const { externalId } of customers) {
    try {
      const { wallets } = await lagoClient.listWalletsForCustomer(externalId);
      fetched += wallets.length;
      for (const w of wallets) {
        try {
          await upsertWallet(w, externalId);
          freshIds.add(w.lago_id);
          upserted++;
        } catch (err) {
          errors.push({
            lagoId: w.lago_id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      errors.push({
        lagoId: externalId,
        message: `listWalletsForCustomer(${externalId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  const localActive = await db
    .select({ lagoId: lagoWallets.lagoId })
    .from(lagoWallets)
    .where(isNull(lagoWallets.deletedAt));
  const orphanIds = findOrphans(freshIds, localActive.map((r) => r.lagoId));

  if (orphanIds.length > 0) {
    await db
      .update(lagoWallets)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoWallets.lagoId, orphanIds));
  }

  return {
    entity: "lago_wallets",
    fetched,
    upserted,
    orphaned: orphanIds.length,
    durationMs: Date.now() - start,
    errors,
  };
}

export async function upsertWallet(
  w: LagoWallet,
  externalCustomerId?: string,
): Promise<void> {
  const values = {
    lagoId: w.lago_id,
    externalCustomerId: externalCustomerId ?? w.external_customer_id ?? null,
    status: w.status ?? null,
    currency: w.currency,
    balanceCents: w.balance_cents ?? null,
    payload: w as unknown as Record<string, unknown>,
    lagoUpdatedAt: parseLagoTimestamp(
      w.last_balance_sync_at ?? w.created_at ?? null,
    ),
    syncedAt: new Date(),
    deletedAt: null,
  };
  await db
    .insert(lagoWallets)
    .values(values)
    .onConflictDoUpdate({
      target: lagoWallets.lagoId,
      set: {
        externalCustomerId: values.externalCustomerId,
        status: values.status,
        currency: values.currency,
        balanceCents: values.balanceCents,
        payload: values.payload,
        lagoUpdatedAt: values.lagoUpdatedAt,
        syncedAt: values.syncedAt,
        deletedAt: null,
      },
    });
}

export async function softDeleteWallet(lagoId: string): Promise<void> {
  await db
    .update(lagoWallets)
    .set({ deletedAt: new Date() })
    .where(and(eq(lagoWallets.lagoId, lagoId), isNull(lagoWallets.deletedAt)));
}
