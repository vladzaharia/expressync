#!/usr/bin/env -S deno run -A
/**
 * Backfill auto-managed `OCPP-{externalId}` parent tags for every Lago
 * customer.
 *
 * Pass `--apply` to actually write to StEvE + DB. Without it, the script
 * runs as a dry-run and only logs what it would do.
 *
 * What it does
 *   1. List all Lago customers.
 *   2. For each, call `ensureCustomerMetaTag(externalId, name)` which:
 *      - upserts the StEvE `OCPP-{externalId}` tag (active state mirrors
 *        first active subscription),
 *      - upserts the `user_mappings` row.
 *   3. Reparent every existing customer-linked `user_mappings` row so its
 *      `steveParentIdTag` equals `OCPP-{externalId}`. Triggers a single
 *      StEvE sync per affected mapping so the parent edge propagates.
 *
 * What it does NOT do
 *   - Delete legacy `OCPP-VLAD` / `OCPP-JON` style organizational meta-
 *     tags. The StEvE client doesn't expose a delete method yet; remove
 *     them via the StEvE UI after confirming no children rely on them
 *     (children should already have been re-parented to `OCPP-{externalId}`
 *     via step 3, but verify before deleting). A future helper should add
 *     this once `steveClient.deleteOcppTag` is available.
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/src/db/index.ts";
import * as schema from "@/src/db/schema.ts";
import { lagoClient } from "@/src/lib/lago-client.ts";
import {
  ensureCustomerMetaTag,
  parentIdTagFor,
} from "@/src/lib/customer-meta-tags.ts";
import { syncSingleTagToSteve } from "@/src/services/tag-sync.service.ts";

const APPLY = Deno.args.includes("--apply");

async function main() {
  console.log(
    APPLY
      ? "RUNNING in APPLY mode — writes will hit StEvE + DB."
      : "DRY-RUN — pass --apply to write.",
  );

  // 1. Backfill meta-tags per Lago customer
  const { customers } = await lagoClient.getCustomers();
  console.log(`Found ${customers.length} Lago customers.`);

  let createdOrRefreshed = 0;
  for (const c of customers) {
    if (!c.external_id) continue;
    if (!APPLY) {
      console.log(
        `  would ensureCustomerMetaTag(${c.external_id}, ${c.name ?? "—"})`,
      );
      createdOrRefreshed++;
      continue;
    }
    try {
      const r = await ensureCustomerMetaTag(
        c.external_id,
        c.name ?? c.external_id,
      );
      console.log(
        `  ensured ${r.idTag} (pk=${r.ocppTagPk ?? "—"}, active=${r.isActive})`,
      );
      createdOrRefreshed++;
    } catch (err) {
      console.error(`  FAILED ${c.external_id}:`, err);
    }
  }
  console.log(`Meta-tag pass: ${createdOrRefreshed} customers processed.`);

  // 2. Re-parent every linked mapping to its canonical parent.
  const linked = await db
    .select()
    .from(schema.userMappings)
    .where(isNotNull(schema.userMappings.lagoCustomerExternalId));
  console.log(`Found ${linked.length} linked user_mappings rows.`);

  let reparented = 0;
  for (const m of linked) {
    if (!m.lagoCustomerExternalId) continue;
    if (m.steveOcppIdTag.startsWith("OCPP-")) continue; // skip meta-tags themselves
    const desired = parentIdTagFor(m.lagoCustomerExternalId);
    if (m.steveParentIdTag === desired) continue;
    if (!APPLY) {
      console.log(
        `  would reparent ${m.steveOcppIdTag} from ${
          m.steveParentIdTag ?? "(none)"
        } → ${desired}`,
      );
      reparented++;
      continue;
    }
    try {
      const [updated] = await db
        .update(schema.userMappings)
        .set({ steveParentIdTag: desired, updatedAt: new Date() })
        .where(eq(schema.userMappings.id, m.id))
        .returning();
      await syncSingleTagToSteve(updated);
      console.log(
        `  reparented ${updated.steveOcppIdTag} → ${desired}`,
      );
      reparented++;
    } catch (err) {
      console.error(`  FAILED reparent ${m.steveOcppIdTag}:`, err);
    }
  }
  console.log(`Re-parent pass: ${reparented} mappings adjusted.`);

  console.log(APPLY ? "Done." : "Dry-run complete. Re-run with --apply.");
}

if (import.meta.main) {
  await main();
}
