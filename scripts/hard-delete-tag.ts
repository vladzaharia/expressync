#!/usr/bin/env -S deno run -A
/**
 * Hard-delete a single user_mappings row + its StEvE tag.
 *
 * Used when an admin needs to permanently retire a tag and the soft-
 * deactivate path isn't enough (e.g. the StEvE row keeps getting
 * resurrected by the orphan-PK rescue pass in
 * `migrate-customer-meta-tags.ts`, which only skips inactive rows).
 *
 * Usage:
 *   deno run -A scripts/hard-delete-tag.ts <idTag>           # dry-run
 *   deno run -A scripts/hard-delete-tag.ts <idTag> --apply
 *
 * Safety:
 *   - Refuses to run if `synced_transaction_events` or `issued_cards`
 *     reference the mapping (delete would orphan billing history).
 *   - Refuses to run on META- / OCPP- (non-D-) parent tags — those are
 *     auto-managed by `ensureCustomerMetaTag`.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/src/db/index.ts";
import * as schema from "@/src/db/schema.ts";
import { steveClient } from "@/src/lib/steve-client.ts";

const idTag = Deno.args.find((a) => !a.startsWith("--"));
const APPLY = Deno.args.includes("--apply");

if (!idTag) {
  console.error("Usage: hard-delete-tag.ts <idTag> [--apply]");
  Deno.exit(1);
}

if (
  idTag.startsWith("META-") ||
  (idTag.startsWith("OCPP-") && !idTag.startsWith("OCPP-D-"))
) {
  console.error(
    `Refusing to delete parent meta-tag ${idTag} — these are auto-managed.`,
  );
  Deno.exit(1);
}

const [row] = await db
  .select()
  .from(schema.userMappings)
  .where(eq(schema.userMappings.steveOcppIdTag, idTag));

if (!row) {
  console.log(`No user_mappings row with idTag=${idTag}. Nothing to do.`);
  Deno.exit(0);
}

console.log(
  `Found mapping id=${row.id} pk=${row.steveOcppTagPk} active=${row.isActive}`,
);

// FK guard — refuse if historical data references this mapping.
const [{ c: txN }] = await db.execute<{ c: number }>(
  sql`SELECT count(*)::int AS c FROM synced_transaction_events WHERE user_mapping_id = ${row.id}`,
);
const [{ c: cardN }] = await db.execute<{ c: number }>(
  sql`SELECT count(*)::int AS c FROM issued_cards WHERE user_mapping_id = ${row.id}`,
);
console.log(`FK refs: synced_transaction_events=${txN} issued_cards=${cardN}`);
if (txN > 0 || cardN > 0) {
  console.error(
    "Mapping is referenced by historical data. Aborting hard-delete.",
  );
  console.error(
    "Run the soft-deactivate UI path instead (DELETE /api/admin/tag/link?id=...)",
  );
  Deno.exit(2);
}

if (!APPLY) {
  console.log("DRY-RUN — pass --apply to actually delete.");
  Deno.exit(0);
}

// 1. Delete from StEvE first — if this fails (404, etc.) we still
//    want the local row gone so the orphan-PK rescue doesn't recreate.
try {
  await steveClient.deleteOcppTag(row.steveOcppTagPk);
  console.log(`StEvE tag PK=${row.steveOcppTagPk} deleted.`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("404")) {
    console.log(
      `StEvE tag PK=${row.steveOcppTagPk} already gone — proceeding.`,
    );
  } else {
    console.error(`StEvE delete failed: ${msg}`);
    console.error("Aborting — re-run after StEvE is reachable.");
    Deno.exit(3);
  }
}

// 2. Hard-delete the local row.
await db
  .delete(schema.userMappings)
  .where(eq(schema.userMappings.id, row.id));
console.log(`user_mappings row id=${row.id} deleted.`);
console.log("Done.");
