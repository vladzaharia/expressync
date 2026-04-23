/**
 * GET  /api/customer/profile  — return the authenticated customer's profile
 * PUT  /api/customer/profile  — update name (email change is admin-only;
 *                               rejected here per the lifecycle plan)
 *
 * No `assertOwnership` needed beyond authentication: this endpoint is always
 * scoped to the caller's own user_id (`ctx.state.user.id`). When an admin
 * impersonates (`ctx.state.actingAs`), GET returns the impersonated
 * customer's profile; PUT is rejected (read-only impersonation).
 *
 * Profile shape mirrors what the Account page renders + per-card mappings
 * for the "linked cards" section.
 */

import { define } from "../../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { logCustomerAction } from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerProfileAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getProfile(userId: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      onboardedAt: schema.users.onboardedAt,
      emailVerified: schema.users.emailVerified,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;

  const mappings = await db
    .select({
      id: schema.userMappings.id,
      displayName: schema.userMappings.displayName,
      ocppTagId: schema.userMappings.steveOcppIdTag,
      ocppTagPk: schema.userMappings.steveOcppTagPk,
      isActive: schema.userMappings.isActive,
      tagType: schema.userMappings.tagType,
      lagoCustomerExternalId: schema.userMappings.lagoCustomerExternalId,
    })
    .from(schema.userMappings)
    .where(eq(schema.userMappings.userId, userId));

  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified ?? false,
    onboardedAt: user.onboardedAt ? user.onboardedAt.toISOString() : null,
    createdAt: user.createdAt ? user.createdAt.toISOString() : null,
    mappings,
  };
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const targetUserId = ctx.state.actingAs ?? ctx.state.user.id;

    try {
      const profile = await getProfile(targetUserId);
      if (!profile) return jsonResponse(404, { error: "Profile not found" });
      return jsonResponse(200, { profile });
    } catch (err) {
      log.error("Failed to fetch profile", err as Error);
      return jsonResponse(500, { error: "Failed to fetch profile" });
    }
  },

  async PUT(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only while impersonating; use admin tools to mutate.",
      });
    }

    let body: { name?: unknown; email?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const { name, email } = body;

    // Email changes are admin-only per the customer lifecycle plan
    // ("Lago email drift handling" — admin reconciles via user-management).
    if (typeof email === "string") {
      return jsonResponse(403, {
        error: "Email changes must be done by an operator. Contact support.",
      });
    }

    if (name !== undefined && (typeof name !== "string" || name.length > 200)) {
      return jsonResponse(400, {
        error: "name must be a string up to 200 characters",
      });
    }

    try {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof name === "string") patch.name = name.trim();
      if (Object.keys(patch).length === 1) {
        return jsonResponse(400, { error: "No valid fields to update" });
      }

      await db
        .update(schema.users)
        .set(patch)
        .where(eq(schema.users.id, ctx.state.user.id));

      await logCustomerAction({
        userId: ctx.state.user.id,
        action: "profile-update",
        route: new URL(ctx.req.url).pathname,
        metadata: {
          fields: Object.keys(patch).filter((k) => k !== "updatedAt"),
        },
      });

      const profile = await getProfile(ctx.state.user.id);
      return jsonResponse(200, { profile });
    } catch (err) {
      log.error("Failed to update profile", err as Error);
      return jsonResponse(500, { error: "Failed to update profile" });
    }
  },
});
