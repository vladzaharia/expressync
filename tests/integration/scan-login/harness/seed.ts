/**
 * seed.ts — one-shot seeding after the stack is up + healthy.
 *
 * SteVe side (mariadb):
 *   - INSERT ocpp_tag rows for TAG_GOOD (unblocked) and TAG_BLOCKED
 *     (blocked = 1).
 *   - Register charge_box rows for CB_A and CB_B so SteVe accepts the
 *     incoming WS connections without complaining about unknown CPs.
 *
 * ExpresSync side (postgres):
 *   - INSERT a `users` row (role=customer).
 *   - INSERT a `user_mappings` row tying TAG_GOOD → that user, is_active=true.
 */

import { type ComposeContext } from "./compose.ts";
import { mysqlQuery, pgQuery } from "./db.ts";

export interface SeedValues {
  CB_A: string;
  CB_B: string;
  TAG_GOOD: string;
  TAG_BLOCKED: string;
  TAG_UNKNOWN: string;
  STEVE_DB_PASSWORD: string;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

export async function seedSteve(
  ctx: ComposeContext,
  v: SeedValues,
): Promise<void> {
  const stmts = [
    // SteVe schema: ocpp_tag (id_tag UNIQUE, parent_id_tag, expiry_date,
    // in_transaction, blocked, max_active_transaction_count, note).
    // charge_box (charge_box_id UNIQUE, registration_status, ...).
    `INSERT IGNORE INTO ocpp_tag (id_tag, parent_id_tag, expiry_date, in_transaction, blocked, max_active_transaction_count, note)
       VALUES ('${sqlEscape(v.TAG_GOOD)}', NULL, NULL, 0, 0, 1, 'cpsim-good');`,
    `INSERT IGNORE INTO ocpp_tag (id_tag, parent_id_tag, expiry_date, in_transaction, blocked, max_active_transaction_count, note)
       VALUES ('${sqlEscape(v.TAG_BLOCKED)}', NULL, NULL, 0, 1, 1, 'cpsim-blocked');`,
    `INSERT IGNORE INTO charge_box (charge_box_id, registration_status, insert_connector_status_after_transaction_msg)
       VALUES ('${sqlEscape(v.CB_A)}', 'Accepted', 0);`,
    `INSERT IGNORE INTO charge_box (charge_box_id, registration_status, insert_connector_status_after_transaction_msg)
       VALUES ('${sqlEscape(v.CB_B)}', 'Accepted', 0);`,
  ];
  // Some SteVe versions don't have insert_connector_status_after_transaction_msg.
  // Try the four-column form, fall back to the two-column form on error.
  for (const stmt of stmts) {
    try {
      await mysqlQuery(ctx, v.STEVE_DB_PASSWORD, stmt);
    } catch (err) {
      if (stmt.startsWith("INSERT IGNORE INTO charge_box")) {
        // Retry with minimal column set (compatible with older schemas).
        const m = stmt.match(/'([^']+)'/);
        if (!m) throw err;
        await mysqlQuery(
          ctx,
          v.STEVE_DB_PASSWORD,
          `INSERT IGNORE INTO charge_box (charge_box_id, registration_status) VALUES ('${m[1]}', 'Accepted');`,
        );
      } else {
        throw err;
      }
    }
  }
}

export interface SeededUser {
  userId: string;
  mappingId: number;
}

export async function seedExpressync(
  ctx: ComposeContext,
  v: SeedValues,
): Promise<SeededUser> {
  const userId = crypto.randomUUID();
  const email = `cpsim-${userId.slice(0, 8)}@test.local`;
  await pgQuery(
    ctx,
    null,
    `INSERT INTO users (id, name, email, role, email_verified, created_at, updated_at)
     VALUES ('${userId}', 'cpsim user', '${email}', 'customer', true, now(), now());`,
  );
  const r = await pgQuery(
    ctx,
    null,
    `INSERT INTO user_mappings (user_id, steve_ocpp_id_tag, is_active, created_at, updated_at)
       VALUES ('${userId}', '${v.TAG_GOOD}', true, now(), now())
     RETURNING id;`,
  );
  const mappingId = parseInt(r.rows[0]?.[0] ?? "0", 10);
  return { userId, mappingId };
}
