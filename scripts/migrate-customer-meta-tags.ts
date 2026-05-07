#!/usr/bin/env -S deno run -A
/**
 * Backfill auto-managed parent tags for every Lago customer.
 *
 * Pass `--apply` to actually write to StEvE + DB. Without it, the script
 * runs as a dry-run and only logs what it would do.
 *
 * 2026-05-07 RENAME — the canonical format moved from
 * `OCPP-{lagoExternalId}` to `OCPP-{userPublicId}`. This script is the
 * one-shot migration that performs the rename safely:
 *
 *   1. List all Lago customers.
 *   2. For each, call `ensureCustomerMetaTag(externalId, name)`. Post-
 *      rename this:
 *        - upserts the new `OCPP-{userPublicId}` tag,
 *        - reparents every child of the legacy `OCPP-{externalId}` tag
 *          to the new tag,
 *        - deactivates the legacy tag (max_active_transaction_count=0)
 *          + flips its local user_mappings row to is_active=false.
 *   3. Reparent every customer-linked `user_mappings` row so its
 *      `steveParentIdTag` matches the new canonical parent. Triggers a
 *      StEvE sync per affected mapping so the StEvE-side parent edge
 *      converges.
 *
 * Idempotent — safe to re-run. Once a customer's tags are migrated,
 * subsequent passes are no-ops (the legacy tag has zero children and
 * is already deactivated).
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/src/db/index.ts";
import * as schema from "@/src/db/schema.ts";
import { lagoClient } from "@/src/lib/lago-client.ts";
import {
  ensureCustomerMetaTag,
  parentIdTagFor,
  parentIdTagForUserPublicId,
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

  // Resolve every customer's userPublicId in one pass so we don't fire
  // a per-row lookup inside the loop.
  const userRows = await db
    .select({
      lagoCustomerExternalId: schema.users.lagoCustomerExternalId,
      publicId: schema.users.publicId,
    })
    .from(schema.users)
    .where(isNotNull(schema.users.lagoCustomerExternalId));
  const externalToPublic = new Map<string, string>();
  for (const r of userRows) {
    if (r.lagoCustomerExternalId && r.publicId) {
      externalToPublic.set(r.lagoCustomerExternalId, r.publicId);
    }
  }

  let reparented = 0;
  for (const m of linked) {
    if (!m.lagoCustomerExternalId) continue;
    if (m.steveOcppIdTag.startsWith("OCPP-")) continue; // skip meta-tags themselves
    // Prefer the new format. Fall back to the legacy format only if a
    // customer somehow has no associated user (shouldn't happen post-
    // migration 0046, but defensive).
    const publicId = externalToPublic.get(m.lagoCustomerExternalId);
    const desired = publicId
      ? parentIdTagForUserPublicId(publicId)
      : parentIdTagFor(m.lagoCustomerExternalId);
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
