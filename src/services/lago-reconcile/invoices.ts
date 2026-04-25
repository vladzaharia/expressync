import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { lagoFees, lagoInvoices } from "../../db/schema.ts";
import { lagoClient } from "../../lib/lago-client.ts";
import type { LagoInvoiceExtended } from "../../lib/types/lago.ts";
import {
  findOrphans,
  parseLagoTimestamp,
  type ReconcileError,
  type ReconcileResult,
} from "./util.ts";

export async function reconcileLagoInvoices(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  const { invoices } = await lagoClient.listAllInvoices();
  let upserted = 0;

  for (const inv of invoices) {
    try {
      await upsertInvoice(inv);
      upserted++;
    } catch (err) {
      errors.push({
        lagoId: inv.lago_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const freshIds = invoices.map((i) => i.lago_id);
  const localActive = await db
    .select({ lagoId: lagoInvoices.lagoId })
    .from(lagoInvoices)
    .where(isNull(lagoInvoices.deletedAt));
  const orphanIds = findOrphans(freshIds, localActive.map((r) => r.lagoId));

  if (orphanIds.length > 0) {
    await db
      .update(lagoInvoices)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoInvoices.lagoId, orphanIds));
    // Also soft-mark their fees so queries on active data stay consistent.
    await db
      .update(lagoFees)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoFees.invoiceLagoId, orphanIds));
  }

  return {
    entity: "lago_invoices",
    fetched: invoices.length,
    upserted,
    orphaned: orphanIds.length,
    durationMs: Date.now() - start,
    errors,
  };
}

export async function upsertInvoice(
  inv: LagoInvoiceExtended,
): Promise<void> {
  const values = {
    lagoId: inv.lago_id,
    number: inv.number ?? null,
    externalCustomerId: inv.external_customer_id ?? null,
    status: inv.status ?? null,
    paymentStatus: inv.payment_status ?? null,
    invoiceType: inv.invoice_type ?? null,
    totalAmountCents: inv.total_amount_cents ?? null,
    currency: inv.currency ?? null,
    issuingDate: inv.issuing_date ?? null,
    paymentOverdue: inv.payment_overdue ?? null,
    payload: inv as unknown as Record<string, unknown>,
    lagoUpdatedAt: parseLagoTimestamp(
      inv.updated_at ?? inv.created_at ?? null,
    ),
    syncedAt: new Date(),
    deletedAt: null,
  };

  await db
    .insert(lagoInvoices)
    .values(values)
    .onConflictDoUpdate({
      target: lagoInvoices.lagoId,
      set: {
        number: values.number,
        externalCustomerId: values.externalCustomerId,
        status: values.status,
        paymentStatus: values.paymentStatus,
        invoiceType: values.invoiceType,
        totalAmountCents: values.totalAmountCents,
        currency: values.currency,
        issuingDate: values.issuingDate,
        paymentOverdue: values.paymentOverdue,
        payload: values.payload,
        lagoUpdatedAt: values.lagoUpdatedAt,
        syncedAt: values.syncedAt,
        deletedAt: null,
      },
    });

  // Nested fees — list endpoints don't return them, so only re-sync fees when
  // the webhook / detail fetch gave us an invoice with a `fees[]` payload.
  if (Array.isArray(inv.fees) && inv.fees.length > 0) {
    await upsertInvoiceFees(inv.lago_id, inv.fees);
  }
}

export async function upsertInvoiceFees(
  invoiceLagoId: string,
  fees: Array<Record<string, unknown>>,
): Promise<void> {
  const pickStr = (obj: Record<string, unknown>, key: string): string | null =>
    typeof obj[key] === "string" ? (obj[key] as string) : null;
  const pickNum = (obj: Record<string, unknown>, key: string): number | null =>
    typeof obj[key] === "number" ? (obj[key] as number) : null;

  const freshFeeIds: string[] = [];

  for (const f of fees) {
    const lagoId = pickStr(f, "lago_id");
    if (!lagoId) continue;
    freshFeeIds.push(lagoId);

    const item = (f.item as Record<string, unknown> | undefined) ?? {};
    const values = {
      lagoId,
      invoiceLagoId,
      externalSubscriptionId: pickStr(f, "external_subscription_id"),
      itemCode: pickStr(item, "code"),
      itemName: pickStr(item, "name"),
      units: pickStr(f, "units"),
      amountCents: pickNum(f, "amount_cents"),
      currency: pickStr(f, "amount_currency"),
      payload: f,
      syncedAt: new Date(),
      deletedAt: null as Date | null,
    };
    await db
      .insert(lagoFees)
      .values(values)
      .onConflictDoUpdate({
        target: lagoFees.lagoId,
        set: {
          invoiceLagoId: values.invoiceLagoId,
          externalSubscriptionId: values.externalSubscriptionId,
          itemCode: values.itemCode,
          itemName: values.itemName,
          units: values.units,
          amountCents: values.amountCents,
          currency: values.currency,
          payload: values.payload,
          syncedAt: values.syncedAt,
          deletedAt: null,
        },
      });
  }

  // Soft-delete fees belonging to this invoice that no longer appear — Lago
  // occasionally drops fees on draft refresh.
  const localFees = await db
    .select({ lagoId: lagoFees.lagoId })
    .from(lagoFees)
    .where(
      and(
        eq(lagoFees.invoiceLagoId, invoiceLagoId),
        isNull(lagoFees.deletedAt),
      ),
    );
  const orphanFeeIds = findOrphans(
    freshFeeIds,
    localFees.map((r) => r.lagoId),
  );
  if (orphanFeeIds.length > 0) {
    await db
      .update(lagoFees)
      .set({ deletedAt: new Date() })
      .where(inArray(lagoFees.lagoId, orphanFeeIds));
  }
}

export async function softDeleteInvoice(lagoId: string): Promise<void> {
  await db
    .update(lagoInvoices)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(lagoInvoices.lagoId, lagoId), isNull(lagoInvoices.deletedAt)),
    );
  await db
    .update(lagoFees)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(lagoFees.invoiceLagoId, lagoId), isNull(lagoFees.deletedAt)),
    );
}
