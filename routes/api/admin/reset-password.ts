/**
 * POST /api/admin/reset-password
 *
 * Polaris Track C — admin password reset confirmation. Verifies the
 * reset token, updates the admin's `accounts.password` (providerId =
 * 'credential') with a Better-Auth-compatible scrypt hash, marks the
 * verification consumed, and revokes existing sessions for that user.
 *
 * Body: { token: string, newPassword: string }
 *
 * Verification chain:
 *   1. Token must exist in `verifications` with identifier
 *      `reset:{token}`, not expired, not consumed.
 *   2. Verification value must be JSON `{ userId: string }`.
 *   3. User MUST be `role='admin'` (defense-in-depth — the
 *      `forgot-password` handler only mints tokens for admins, but a
 *      future bug there shouldn't allow customer accounts to be
 *      sessioned via the admin reset path).
 *   4. `newPassword` must be ≥ 12 chars (matches Better-Auth's
 *      `minPasswordLength` config).
 *   5. Hash via Better-Auth's `hashPassword` so the result is verifiable
 *      by the standard `signInEmail` flow.
 *   6. UPDATE accounts.password WHERE providerId='credential' AND
 *      userId = $1. If no credential account exists, INSERT one.
 *   7. DELETE the verification row (single-use).
 *   8. DELETE all existing sessions for the user (force re-login).
 *   9. Audit `password.reset_completed`.
 *
 * Public route — admins are not logged in when they reset.
 */

import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import {
  accounts,
  sessions as sessionsTable,
  users,
  verifications,
} from "../../../src/db/schema.ts";
import { logAuthEvent } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("AdminResetPassword");

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

interface ResetBody {
  token?: string;
  newPassword?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    let body: ResetBody;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const newPassword = typeof body.newPassword === "string"
      ? body.newPassword
      : "";
    if (!token) {
      return jsonResponse(400, { error: "token_required" });
    }
    if (
      newPassword.length < MIN_PASSWORD_LENGTH ||
      newPassword.length > MAX_PASSWORD_LENGTH
    ) {
      return jsonResponse(400, {
        error:
          `password_must_be_${MIN_PASSWORD_LENGTH}_to_${MAX_PASSWORD_LENGTH}_chars`,
      });
    }

    const ip = getClientIp(ctx.req);
    const ua = ctx.req.headers.get("user-agent");
    const identifier = `reset:${token}`;

    // 1. Look up verification row.
    let row:
      | { id: string; value: string; expiresAt: Date | string }
      | undefined;
    try {
      const [found] = await db
        .select({
          id: verifications.id,
          value: verifications.value,
          expiresAt: verifications.expiresAt,
        })
        .from(verifications)
        .where(eq(verifications.identifier, identifier))
        .limit(1);
      row = found;
    } catch (err) {
      log.error("verification lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!row) {
      return jsonResponse(400, { error: "invalid_token" });
    }
    const expiresAt = row.expiresAt instanceof Date
      ? row.expiresAt
      : new Date(row.expiresAt as string);
    if (expiresAt.getTime() < Date.now()) {
      return jsonResponse(400, { error: "invalid_token" });
    }

    // 2. Decode the value → userId.
    let userId: string | null = null;
    try {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed.userId === "string") {
        userId = parsed.userId;
      }
    } catch {
      // ignore — handled below
    }
    if (!userId) {
      log.error("verification row malformed", { id: row.id });
      return jsonResponse(400, { error: "invalid_token" });
    }

    // 3. User must be admin.
    let user: { id: string; role: string; email: string | null } | undefined;
    try {
      const [u] = await db
        .select({ id: users.id, role: users.role, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      user = u;
    } catch (err) {
      log.error("user lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!user) {
      return jsonResponse(400, { error: "invalid_token" });
    }
    if (user.role !== "admin") {
      // Don't surface to caller, but audit.
      void logAuthEvent("password.reset_attempted_for_non_admin", {
        userId: user.id,
        ip,
        ua,
        route: "/api/admin/reset-password",
        metadata: { reason: "non_admin_token_at_admin_reset" },
      });
      return jsonResponse(400, { error: "invalid_token" });
    }

    // 4 + 5. Hash + persist.
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(newPassword);
    } catch (err) {
      log.error("hashPassword failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    try {
      // Find existing credential account.
      const [existing] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, user.id),
            eq(accounts.providerId, "credential"),
          ),
        )
        .limit(1);
      if (existing) {
        await db
          .update(accounts)
          .set({ password: passwordHash, updatedAt: new Date() })
          .where(eq(accounts.id, existing.id));
      } else {
        await db.insert(accounts).values({
          id: crypto.randomUUID(),
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        });
      }
    } catch (err) {
      log.error("account password update failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    // 6. Delete verification (single-use).
    try {
      await db.delete(verifications).where(eq(verifications.id, row.id));
    } catch (err) {
      log.warn("verification cleanup failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 7. Revoke existing sessions for this user — they need to re-login.
    try {
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
    } catch (err) {
      log.warn("session revocation failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 8. Audit success.
    void logAuthEvent("password.reset_completed", {
      userId: user.id,
      ip,
      ua,
      route: "/api/admin/reset-password",
    });

    return jsonResponse(200, { redirectTo: "/login" });
  },
});
