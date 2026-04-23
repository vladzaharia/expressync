/**
 * POST /api/admin/forgot-password
 *
 * Polaris Track C — admin-only password-reset trigger. Anti-enumeration:
 * always responds 200 with the same shape regardless of whether the
 * email is recognized.
 *
 * Body: { email: string }
 *
 * Behavior:
 *   1. Composite rate limit (per IP, per email).
 *   2. Look up user by LOWER(email) = LOWER($1).
 *   3. If found AND role='admin':
 *        - Generate 24h password-reset token (random 32 bytes, base64url).
 *        - Insert verifications row:
 *            identifier = "reset:{token}"
 *            value      = JSON.stringify({ userId })
 *            expiresAt  = now + ADMIN_PASSWORD_RESET_TTL_SECONDS
 *        - Send via sendAdminPasswordReset.
 *        - Audit `password.reset_requested`.
 *   4. If found AND role !== 'admin':
 *        - Audit `password.reset_attempted_for_non_admin`. NO email sent.
 *   5. If not found: NO side effects.
 *   6. Always respond 200 { status: "ok" }.
 *
 * Public route — admins are by definition not logged in when they hit
 * this endpoint.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { users, verifications } from "../../../src/db/schema.ts";
import { config } from "../../../src/lib/config.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import { hashEmail, logAuthEvent } from "../../../src/lib/audit.ts";
import { sendAdminPasswordReset } from "../../../src/lib/email.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("AdminForgotPassword");

const RATE_LIMIT_PER_EMAIL = 3; // per minute window — reuse the existing 60s
const RATE_LIMIT_PER_IP = 10;

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function uniformOk(): Response {
  return new Response(
    JSON.stringify({ status: "ok" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function badRequest(error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

function rateLimited(): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateResetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const handler = define.handlers({
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return badRequest("invalid_json");
    }
    const emailRaw = (body as { email?: unknown }).email;
    if (typeof emailRaw !== "string") {
      return badRequest("email_required");
    }
    const email = emailRaw.trim().toLowerCase();
    if (email === "" || !isLikelyEmail(email)) {
      return badRequest("invalid_email");
    }

    const ip = getClientIp(ctx.req);
    if (!await checkRateLimit(`forgotpw:ip:${ip}`, RATE_LIMIT_PER_IP)) {
      return rateLimited();
    }
    if (
      !await checkRateLimit(`forgotpw:email:${email}`, RATE_LIMIT_PER_EMAIL)
    ) {
      return rateLimited();
    }

    let row: { id: string; role: string; email: string | null } | undefined;
    try {
      const [found] = await db
        .select({
          id: users.id,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      row = found;
    } catch (err) {
      log.error("user lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return uniformOk();
    }

    if (!row) {
      // No-op — uniform response.
      return uniformOk();
    }

    const eh = await hashEmail(email);

    if (row.role !== "admin") {
      // Non-admin email at admin-reset surface — log only, no email.
      void logAuthEvent("password.reset_attempted_for_non_admin", {
        userId: row.id,
        emailHash: eh,
        ip,
        ua: ctx.req.headers.get("user-agent"),
        route: "/api/admin/forgot-password",
      });
      return uniformOk();
    }

    // Admin path: mint token + send email.
    const token = generateResetToken();
    const identifier = `reset:${token}`;
    const value = JSON.stringify({ userId: row.id });
    const expiresAt = new Date(
      Date.now() + config.ADMIN_PASSWORD_RESET_TTL_SECONDS * 1000,
    );

    try {
      await db.insert(verifications).values({
        id: crypto.randomUUID(),
        identifier,
        value,
        expiresAt,
      });
    } catch (err) {
      log.error("Failed to insert reset verification", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Still return ok — uniformity matters more than internal feedback.
      return uniformOk();
    }

    void logAuthEvent("password.reset_requested", {
      userId: row.id,
      emailHash: eh,
      ip,
      ua: ctx.req.headers.get("user-agent"),
      route: "/api/admin/forgot-password",
    });

    const resetUrl = `${config.ADMIN_BASE_URL}/reset-password?token=${
      encodeURIComponent(token)
    }`;
    // sendAdminPasswordReset NEVER throws — it returns a SendEmailResult.
    // Worker outages / misconfig surface as `result.ok=false`; we log but
    // continue to return uniformOk() so a transport hiccup never tells the
    // caller "your email is valid but outbound failed" (anti-enumeration).
    const result = await sendAdminPasswordReset(email, resetUrl);
    if (!result.ok) {
      log.error("sendAdminPasswordReset failed", {
        status: result.status,
        reason: result.reason,
      });
    }

    return uniformOk();
  },
});
