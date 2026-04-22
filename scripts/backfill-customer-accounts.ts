#!/usr/bin/env -S deno run -A
/**
 * Polaris Track A — one-shot backfill for existing user_mappings rows.
 *
 * Today there are existing `user_mappings` rows with `user_id IS NULL`.
 * After deploying migrations 0017–0027, an admin runs this script once to
 * create or link the customer accounts that should own those mappings.
 *
 * Algorithm:
 *   1. SELECT rows where user_id IS NULL AND lago_customer_external_id IS
 *      NOT NULL (rows with no Lago customer can't be auto-linked — admin
 *      must fix those manually).
 *   2. Group by lago_customer_external_id (so a customer with multiple
 *      tags goes through resolveOrCreateCustomerAccount once).
 *   3. For each group: open a transaction, call
 *      resolveOrCreateCustomerAccount, UPDATE every sibling mapping with
 *      the resolved userId.
 *   4. Print one CSV line per starting mapping with the outcome.
 *
 * Idempotent: re-running picks up only still-NULL rows. Safe to interrupt
 * (each Lago group is its own transaction).
 *
 * Flags:
 *   --dry-run         Roll back every transaction; print what WOULD change.
 *   --limit=N         Process at most N Lago customer groups (not rows).
 *
 * Output (CSV, to stdout):
 *   mapping_id,lago_customer_id,lago_email,outcome,user_id,note
 *
 * outcome ∈ {created, linked_existing, skipped_no_email, skipped_admin_email,
 *            skipped_lago_collision, skipped_lago_404, skipped_error}
 *
 * Exit codes:
 *   0 — success (all groups processed)
 *   1 — partial failure (one or more group transactions threw)
 *   2 — fatal (unable to start, e.g. missing DATABASE_URL)
 */

import "../src/lib/config.ts";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { userMappings } from "../src/db/schema.ts";
import {
  ProvisionerError,
  resolveOrCreateCustomerAccount,
} from "../src/services/customer-account-provisioner.ts";

interface CliFlags {
  dryRun: boolean;
  limit: number | null;
}

function parseFlags(args: string[]): CliFlags {
  let dryRun = false;
  let limit: number | null = null;
  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`Invalid --limit value: ${arg.slice("--limit=".length)}`);
        Deno.exit(2);
      }
      limit = n;
    } else if (arg === "--help" || arg === "-h") {
      console.error(
        "Usage: deno run -A scripts/backfill-customer-accounts.ts [--dry-run] [--limit=N]",
      );
      Deno.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      Deno.exit(2);
    }
  }
  return { dryRun, limit };
}

interface CsvRow {
  mappingId: number;
  lagoCustomerId: string;
  lagoEmail: string;
  outcome:
    | "created"
    | "linked_existing"
    | "skipped_no_email"
    | "skipped_admin_email"
    | "skipped_lago_collision"
    | "skipped_lago_404"
    | "skipped_lago_5xx"
    | "skipped_error";
  userId: string;
  note: string;
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function emit(row: CsvRow): void {
  const line = [
    row.mappingId,
    row.lagoCustomerId,
    row.lagoEmail,
    row.outcome,
    row.userId,
    row.note,
  ].map((v) => csvEscape(String(v))).join(",");
  console.log(line);
}

/**
 * Map a `ProvisionerError.code` to a CSV outcome string.
 */
function classifyProvisionerError(err: ProvisionerError): CsvRow["outcome"] {
  switch (err.code) {
    case "LAGO_EMAIL_MISSING":
    case "LAGO_EMAIL_MALFORMED":
      return "skipped_no_email";
    case "EMAIL_BELONGS_TO_ADMIN":
      return "skipped_admin_email";
    case "EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER":
      return "skipped_lago_collision";
    case "LAGO_CUSTOMER_NOT_FOUND":
      return "skipped_lago_404";
    case "LAGO_FETCH_FAILED":
      return "skipped_lago_5xx";
    default:
      return "skipped_error";
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(Deno.args);

  // CSV header to stdout (downstream tools expect a leading row).
  console.log("mapping_id,lago_customer_id,lago_email,outcome,user_id,note");

  // 1. Fetch all NULL-userId, has-Lago-customer rows. Order by lago id +
  //    mapping id so the grouping below is stable.
  const candidates = await db
    .select({
      id: userMappings.id,
      lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
    })
    .from(userMappings)
    .where(
      and(
        isNull(userMappings.userId),
        isNotNull(userMappings.lagoCustomerExternalId),
      ),
    );

  // 2. Group by lago id. We carry the smallest mapping id as the
  //    "representative" for the CSV; siblings appear as separate rows so the
  //    operator can confirm the cascade landed on each.
  const groups = new Map<string, number[]>();
  for (const row of candidates) {
    const lagoId = row.lagoCustomerExternalId as string;
    const list = groups.get(lagoId) ?? [];
    list.push(row.id);
    groups.set(lagoId, list);
  }

  console.error(
    `[backfill] found ${candidates.length} mapping rows across ${groups.size} Lago customer(s)`,
  );
  if (flags.dryRun) {
    console.error("[backfill] DRY-RUN mode: no DB writes will commit");
  }
  if (flags.limit !== null) {
    console.error(`[backfill] limit=${flags.limit} groups`);
  }

  let processedGroups = 0;
  let failures = 0;

  for (const [lagoCustomerId, mappingIds] of groups) {
    if (flags.limit !== null && processedGroups >= flags.limit) break;
    processedGroups += 1;

    try {
      // Open a single transaction per group. In dry-run we throw at the end
      // to roll back. resolveOrCreateCustomerAccount is the same one the
      // admin route uses, so behavior is identical.
      let outcome: CsvRow["outcome"] = "linked_existing";
      let userId = "";
      let email = "";
      let note = "";
      try {
        await db.transaction(async (tx) => {
          const account = await resolveOrCreateCustomerAccount(
            tx,
            lagoCustomerId,
          );
          userId = account.userId;
          email = account.email;
          outcome = account.created ? "created" : "linked_existing";

          // UPDATE every NULL sibling on this Lago customer with the
          // resolved userId. The trigger from migration 0026 ensures this
          // doesn't conflict with any existing non-NULL rows.
          await tx
            .update(userMappings)
            .set({ userId: account.userId, updatedAt: new Date() })
            .where(
              and(
                eq(userMappings.lagoCustomerExternalId, lagoCustomerId),
                isNull(userMappings.userId),
              ),
            );

          if (flags.dryRun) {
            // Force rollback so DB stays unchanged but we still log what
            // would have happened.
            throw new BackfillDryRunRollback();
          }
        });
      } catch (err) {
        if (err instanceof BackfillDryRunRollback) {
          // Expected for --dry-run; outcome/userId already populated.
          note = "dry-run rollback";
        } else {
          throw err;
        }
      }

      // Emit one CSV row per affected mapping so the operator can confirm
      // the cascade landed everywhere.
      for (const mappingId of mappingIds) {
        emit({
          mappingId,
          lagoCustomerId,
          lagoEmail: email,
          outcome,
          userId,
          note,
        });
      }
    } catch (err) {
      failures += 1;
      const provErr = err instanceof ProvisionerError ? err : null;
      const outcome: CsvRow["outcome"] = provErr
        ? classifyProvisionerError(provErr)
        : "skipped_error";
      const note = err instanceof Error ? err.message : String(err);
      for (const mappingId of mappingIds) {
        emit({
          mappingId,
          lagoCustomerId,
          lagoEmail: "",
          outcome,
          userId: "",
          note,
        });
      }
    }
  }

  console.error(
    `[backfill] processed ${processedGroups} group(s), ${failures} failure(s)`,
  );
  if (failures > 0) Deno.exit(1);
}

class BackfillDryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "BackfillDryRunRollback";
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error("[backfill] fatal:", err);
    Deno.exit(2);
  }
}
