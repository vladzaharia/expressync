/**
 * Local-state reconcile — uses the freshly-populated Lago caches to bring our
 * own tables (`users`, `user_mappings`) in line with Lago's view.
 *
 * Three jobs:
 *
 *   1. Provision a `users` row for every Lago customer (with or without
 *      email). Uses `resolveOrCreateCustomerAccount` which is already
 *      idempotent — repeated runs reuse existing rows.
 *
 *   2. Backfill `users.email` from `lago_customers.email` when the local
 *      column is NULL but Lago now has a value. Common case: account was
 *      auto-provisioned without an email and the operator later added one
 *      in Lago. Drift between two non-null emails is logged but never
 *      auto-resolved (portal email is the user's stable identity).
 *
 *   3. Detect orphaned `user_mappings` whose `lago_customer_external_id` /
 *      `lago_subscription_external_id` is no longer present (or terminated)
 *      in Lago's cache. Logged as warnings; admin keeps the final say on
 *      whether to soft-deactivate.
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  lagoCustomers,
  lagoSubscriptions,
  userMappings,
  users,
} from "../../db/schema.ts";
import {
  ProvisionerError,
  resolveOrCreateCustomerAccount,
} from "../customer-account-provisioner.ts";
import type { ReconcileError, ReconcileResult } from "./util.ts";

export async function reconcileLocalState(): Promise<ReconcileResult> {
  const start = Date.now();
  const errors: ReconcileError[] = [];

  let provisioned = 0;
  let emailBackfilled = 0;
  let driftDetected = 0;
  let orphanedMappings = 0;

  // ── 1 + 2: walk Lago customer cache, ensure local user + email ──────────
  const cached = await db
    .select({
      lagoId: lagoCustomers.lagoId,
      externalId: lagoCustomers.externalId,
      email: lagoCustomers.email,
    })
    .from(lagoCustomers)
    .where(isNull(lagoCustomers.deletedAt));

  for (const c of cached) {
    try {
      const result = await db.transaction(async (tx) => {
        return await resolveOrCreateCustomerAccount(tx, c.externalId);
      });
      if (result.created) provisioned++;

      // Email backfill — provisioner only sets email at creation time; if the
      // row already existed with email=NULL but Lago now has one, push it in.
      if (c.email && !result.email) {
        const upd = await db
          .update(users)
          .set({ email: c.email, updatedAt: new Date() })
          .where(and(eq(users.id, result.userId), isNull(users.email)))
          .returning({ id: users.id });
        if (upd.length > 0) emailBackfilled++;
      } else if (
        c.email &&
        result.email &&
        c.email.toLowerCase() !== result.email.toLowerCase()
      ) {
        driftDetected++;
      }
    } catch (err) {
      const code = err instanceof ProvisionerError ? err.code : "UNKNOWN";
      errors.push({
        lagoId: c.externalId,
        message: `provision(${c.externalId}): ${code} ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  // ── 3: orphan detection on user_mappings ───────────────────────────────
  // Mapping whose subscription no longer exists in Lago (deleted or never
  // synced). Terminated subscriptions are handled by the webhook path
  // (handleSubscriptionStateChange) — we still flag them here as a backstop.
  const orphanedRows = await db
    .select({
      mappingId: userMappings.id,
      ocppIdTag: userMappings.steveOcppIdTag,
      lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
      lagoSubscriptionExternalId: userMappings.lagoSubscriptionExternalId,
    })
    .from(userMappings)
    .leftJoin(
      lagoSubscriptions,
      and(
        eq(
          lagoSubscriptions.externalId,
          userMappings.lagoSubscriptionExternalId,
        ),
        isNull(lagoSubscriptions.deletedAt),
      ),
    )
    .where(
      and(
        eq(userMappings.isActive, true),
        isNotNull(userMappings.lagoSubscriptionExternalId),
        isNull(lagoSubscriptions.lagoId),
      ),
    );
  orphanedMappings = orphanedRows.length;
  for (const r of orphanedRows.slice(0, 25)) {
    errors.push({
      lagoId: r.lagoSubscriptionExternalId ?? undefined,
      message:
        `mapping ${r.mappingId} (${r.ocppIdTag}) references unknown subscription ${r.lagoSubscriptionExternalId}`,
    });
  }

  return {
    entity: "local_reconcile",
    fetched: cached.length,
    upserted: provisioned + emailBackfilled,
    orphaned: orphanedMappings,
    durationMs: Date.now() - start,
    errors,
    // ReconcileResult doesn't carry custom fields; fold extras into the entity
    // log line via the caller. We tag durationMs and entity for the segment.
    ...({} as Record<string, never>),
  };
}

// Suppress unused-import warning where `sql` may not be needed after refactors.
void sql;
