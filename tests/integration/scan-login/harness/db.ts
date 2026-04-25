/**
 * db.ts — small wrappers around `docker compose exec <db> <client>` for
 * running queries without bringing in additional Deno dependencies. We
 * use the in-container psql/mysql so that auth + connectivity matches the
 * stack-as-deployed.
 */

import { type ComposeContext, execInService } from "./compose.ts";

export interface PgResult {
  columns: string[];
  rows: string[][];
}

export async function pgQuery(
  ctx: ComposeContext,
  dbUrl: string | null,
  sql: string,
): Promise<PgResult> {
  // Use psql with -A (unaligned) -t (no header) -F$'\t' to get TSV. We
  // request the header via a separate query so callers can know columns.
  const args = dbUrl
    ? ["psql", dbUrl]
    : ["psql", "-U", "ocpp_user", "-d", "ocpp_billing"];
  const r = await execInService(ctx, "postgres", [
    ...args,
    "-At",
    "-F",
    "\t",
    "-c",
    sql,
  ]);
  if (r.code !== 0) {
    throw new Error(`pgQuery failed: ${r.stderr}\nSQL: ${sql}`);
  }
  const lines = r.stdout.replace(/\n$/, "").split("\n").filter((l) => l !== "");
  return {
    columns: [],
    rows: lines.map((l) => l.split("\t")),
  };
}

export async function pgQueryJson<T = Record<string, unknown>>(
  ctx: ComposeContext,
  sql: string,
): Promise<T[]> {
  // `row_to_json` round-trip is the safest way to get typed payloads back
  // through a TSV-formatted psql call.
  const wrapped = `SELECT json_agg(t) FROM (${sql.replace(/;\s*$/, "")}) t`;
  const r = await execInService(ctx, "postgres", [
    "psql",
    "-U",
    "ocpp_user",
    "-d",
    "ocpp_billing",
    "-At",
    "-c",
    wrapped,
  ]);
  if (r.code !== 0) {
    throw new Error(`pgQueryJson failed: ${r.stderr}\nSQL: ${sql}`);
  }
  const out = r.stdout.trim();
  if (!out || out === "") return [];
  try {
    return JSON.parse(out) as T[];
  } catch {
    return [];
  }
}

export async function mysqlQuery(
  ctx: ComposeContext,
  password: string,
  sql: string,
): Promise<string[][]> {
  const r = await execInService(ctx, "mariadb", [
    "mysql",
    "-usteve",
    `-p${password}`,
    "-N",
    "-B",
    "stevedb",
    "-e",
    sql,
  ]);
  if (r.code !== 0) {
    throw new Error(`mysqlQuery failed: ${r.stderr}\nSQL: ${sql}`);
  }
  const lines = r.stdout.replace(/\n$/, "").split("\n").filter((l) => l !== "");
  return lines.map((l) => l.split("\t"));
}
