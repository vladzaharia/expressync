/**
 * Merge duplicate auto-provisioned users that share a Lago customer.
 *
 * Before migration 0030 the reconcile loop created a fresh `users` row
 * every hour for every Lago customer with no email (sibling lookup missed,
 * email lookup was skipped, INSERT blindly succeeded). This script cleans
 * up that accumulated rot:
 *
 *   - Group customer users by (name, email=NULL) — emailless dupes only.
 *     Users with real emails are already deduped by the functional unique
 *     index on `LOWER(email)` so they never accumulated.
 *   - For each group, find the Lago external_id that actually corresponds
 *     to these users (via any mapping they own OR by matching `name` in
 *     `lago_customers`).
 *   - Keep the oldest user row, stamp `lago_customer_external_id` on it,
 *     repoint every mapping/session/reservation to the keeper, then DELETE
 *     the duplicate rows (cascades take care of orphaned session rows).
 *
 * DRY_RUN=1 prints what would change without writing.
 *
 *   deno run -A scripts/merge-lago-duplicates.ts            # apply
 *   DRY_RUN=1 deno run -A scripts/merge-lago-duplicates.ts  # report only
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import {
  accounts,
  authAudit,
  lagoCustomers,
  sessions,
  userMappings,
  users,
} from "../src/db/schema.ts";

const DRY_RUN = Deno.env.get("DRY_RUN") === "1";

interface DuplicateGroup {
  name: string;
  externalId: string | null;
  keeperId: string;
  loserIds: string[];
}

async function main() {
  console.log(`[merge-dupes] mode=${DRY_RUN ? "DRY_RUN" : "APPLY"}`);

  // 1. Find groups of emailless customer users that share a display name.
  const groups = await db
    .select({
      name: users.name,
      userIds: sql<string[]>`array_agg(${users.id} ORDER BY ${users.createdAt})`,
      count: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(and(eq(users.role, "customer"), isNull(users.email)))
    .groupBy(users.name)
    .having(sql`count(*) > 1`);

  if (groups.length === 0) {
    console.log("[merge-dupes] no duplicate groups detected — nothing to do");
    return;
  }

  // 2. Map each group to a Lago external_id. Prefer a mapping on any of the
  //    users; fall back to a `lago_customers` row whose `name` matches.
  const lagoByName = new Map<string, string>();
  const cachedLago = await db
    .select({ externalId: lagoCustomers.externalId, name: lagoCustomers.name })
    .from(lagoCustomers)
    .where(isNull(lagoCustomers.deletedAt));
  for (const row of cachedLago) {
    if (row.name) lagoByName.set(row.name, row.externalId);
  }

  const plan: DuplicateGroup[] = [];
  for (const g of groups) {
    const ids = g.userIds;
    const [oldest, ...rest] = ids;

    const mapping = await db
      .select({ externalId: userMappings.lagoCustomerExternalId })
      .from(userMappings)
      .where(inArray(userMappings.userId, ids))
      .limit(1);
    const externalId = mapping[0]?.externalId ??
      (g.name ? lagoByName.get(g.name) ?? null : null);

    plan.push({
      name: g.name ?? "(unnamed)",
      externalId,
      keeperId: oldest,
      loserIds: rest,
    });
  }

  console.table(
    plan.map((p) => ({
      name: p.name,
      externalId: p.externalId ?? "(unknown)",
      keeper: p.keeperId,
      losersToDelete: p.loserIds.length,
    })),
  );

  if (DRY_RUN) {
    console.log("[merge-dupes] DRY_RUN — no changes written");
    return;
  }

  for (const g of plan) {
    if (!g.externalId) {
      console.warn(
        `[merge-dupes] skipping ${g.name}: could not resolve Lago external_id`,
      );
      continue;
    }
    await db.transaction(async (tx) => {
      // Stamp external_id on the keeper (best-effort; unique partial index
      // means this no-ops if it's already stamped on someone else — in
      // which case that "someone else" should be the keeper instead).
      await tx
        .update(users)
        .set({ lagoCustomerExternalId: g.externalId })
        .where(
          and(
            eq(users.id, g.keeperId),
            isNull(users.lagoCustomerExternalId),
          ),
        );

      // Repoint foreign keys from losers to keeper.
      await tx
        .update(userMappings)
        .set({ userId: g.keeperId })
        .where(inArray(userMappings.userId, g.loserIds));
      await tx
        .update(authAudit)
        .set({ userId: g.keeperId })
        .where(inArray(authAudit.userId, g.loserIds));

      // Best-effort: sessions / accounts cascade on user delete, but
      // deleting the session/account rows explicitly keeps the audit
      // footprint smaller.
      await tx
        .delete(sessions)
        .where(inArray(sessions.userId, g.loserIds));
      await tx
        .delete(accounts)
        .where(inArray(accounts.userId, g.loserIds));

      // Finally, delete the duplicate user rows.
      await tx.delete(users).where(inArray(users.id, g.loserIds));
    });
    console.log(
      `[merge-dupes] merged ${g.loserIds.length} dup(s) for ${g.name} → ${g.keeperId}`,
    );
  }

  console.log("[merge-dupes] done");
}

if (import.meta.main) {
  await main();
  Deno.exit(0);
}
