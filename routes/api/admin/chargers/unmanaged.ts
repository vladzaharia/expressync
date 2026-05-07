/**
 * POST /api/admin/chargers/unmanaged
 *
 * Admin-only (`/api/admin/*` is ADMIN_ONLY in route-classifier; we also
 * re-check `ctx.state.user?.role === "admin"` here as defense-in-depth,
 * mirroring `routes/api/admin/charger/operation.ts`).
 *
 * Creates a new "unmanaged" charger row in `chargers_cache` — used for
 * Tesla Wall Connectors and other non-OCPP units that live entirely in
 * our DB. The sync worker (`charger-cache.service.ts`) skips these rows
 * because they never appear in StEvE's transaction or operation log.
 *
 * Body:
 *   {
 *     chargeBoxId: string,                // unique, [A-Za-z0-9_\-.:]
 *     friendlyName: string,               // 1-200 chars
 *     locationDescription?: string|null,  // ≤500 chars
 *     formFactor?: FormFactor             // default 'wall_mount'
 *   }
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { chargersCache } from "../../../../src/db/schema.ts";
import {
  FORM_FACTORS,
  type FormFactor,
} from "../../../../src/lib/types/steve.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const CHARGE_BOX_ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;

const isFormFactor = (v: unknown): v is FormFactor =>
  typeof v === "string" && (FORM_FACTORS as readonly string[]).includes(v);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(403, { error: "Forbidden — admin role required" });
    }

    let body: {
      chargeBoxId?: unknown;
      friendlyName?: unknown;
      locationDescription?: unknown;
      formFactor?: unknown;
    };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { chargeBoxId, friendlyName, locationDescription, formFactor } = body;

    if (
      typeof chargeBoxId !== "string" || !CHARGE_BOX_ID_RE.test(chargeBoxId)
    ) {
      return jsonResponse(400, {
        error:
          "chargeBoxId is required, ≤64 chars, must match [A-Za-z0-9_\\-.:]",
      });
    }
    if (
      typeof friendlyName !== "string" ||
      friendlyName.length === 0 ||
      friendlyName.length > 200
    ) {
      return jsonResponse(400, {
        error: "friendlyName is required, 1-200 chars",
      });
    }
    if (
      locationDescription !== undefined &&
      locationDescription !== null &&
      (typeof locationDescription !== "string" ||
        locationDescription.length > 500)
    ) {
      return jsonResponse(400, {
        error: "locationDescription must be string ≤500 chars or null",
      });
    }
    const ff: FormFactor = formFactor === undefined
      ? "tesla"
      : (isFormFactor(formFactor) ? formFactor : "tesla");
    if (formFactor !== undefined && !isFormFactor(formFactor)) {
      return jsonResponse(400, {
        error: `Invalid formFactor. Allowed: ${FORM_FACTORS.join(", ")}`,
      });
    }

    // Conflict check before INSERT — clearer error than catching the
    // unique-violation, and avoids burning a tx slot on an obvious dup.
    const existing = await db
      .select({ chargeBoxId: chargersCache.chargeBoxId })
      .from(chargersCache)
      .where(eq(chargersCache.chargeBoxId, chargeBoxId))
      .limit(1);
    if (existing.length > 0) {
      return jsonResponse(409, {
        error: "already_exists",
        message: `A charger with chargeBoxId "${chargeBoxId}" already exists.`,
      });
    }

    try {
      const [inserted] = await db
        .insert(chargersCache)
        .values({
          chargeBoxId,
          friendlyName,
          formFactor: ff,
          managementMode: "unmanaged",
          locationDescription: typeof locationDescription === "string"
            ? locationDescription
            : null,
          // Defaults handle the rest: capabilities=['charger'],
          // first_seen_at=now(), last_seen_at=now(), management_mode is
          // explicit above so the default doesn't override.
        })
        .returning();

      logger.info("API", "Created unmanaged charger", {
        chargeBoxId: inserted.chargeBoxId,
        userId: ctx.state.user?.id,
      });

      return jsonResponse(201, { charger: inserted });
    } catch (error) {
      logger.error(
        "API",
        "Failed to create unmanaged charger",
        error as Error,
      );
      return jsonResponse(500, { error: "Failed to create charger" });
    }
  },
});
