import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { chargersCache } from "../../../../src/db/schema.ts";
import {
  FORM_FACTORS,
  type FormFactor,
} from "../../../../src/lib/types/steve.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const isFormFactor = (v: unknown): v is FormFactor =>
  typeof v === "string" && (FORM_FACTORS as readonly string[]).includes(v);

/** Connector types accepted on the wire — must match the iOS
 *  `ChargerListEntry.ConnectorType` enum and the migration 0040
 *  CHECK constraint. */
const CONNECTOR_TYPES = ["ccs", "j1772", "nacs", "chademo", "type2"] as const;
type ConnectorType = typeof CONNECTOR_TYPES[number];
const isConnectorType = (v: unknown): v is ConnectorType =>
  typeof v === "string" && (CONNECTOR_TYPES as readonly string[]).includes(v);

/**
 * PATCH /api/charger/{chargeBoxId}
 *
 * Admin-only (guarded by `ADMIN_ONLY_PATHS` in the middleware). Updates the
 * mutable fields on a charger cache row — currently `form_factor` and
 * `friendly_name`. Used by the detail page's form-factor dropdown.
 */
export const handler = define.handlers({
  async PATCH(ctx) {
    const chargeBoxId = ctx.params.chargeBoxId;

    let body: Record<string, unknown>;
    try {
      body = await ctx.req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const patch: Record<string, unknown> = {};

    if ("formFactor" in body) {
      if (!isFormFactor(body.formFactor)) {
        return new Response(
          JSON.stringify({
            error: `Invalid formFactor. Allowed: ${FORM_FACTORS.join(", ")}`,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      patch.formFactor = body.formFactor;
    }

    if ("friendlyName" in body) {
      if (body.friendlyName !== null && typeof body.friendlyName !== "string") {
        return new Response(
          JSON.stringify({ error: "friendlyName must be string or null" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      patch.friendlyName = body.friendlyName;
    }

    if ("connectorTypeOverride" in body) {
      if (
        body.connectorTypeOverride !== null &&
        !isConnectorType(body.connectorTypeOverride)
      ) {
        return new Response(
          JSON.stringify({
            error: `Invalid connectorTypeOverride. Allowed: ${
              CONNECTOR_TYPES.join(", ")
            }, or null`,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      patch.connectorTypeOverride = body.connectorTypeOverride;
    }

    if ("maxKwOverride" in body) {
      // Accept null (clear), a positive finite number, or a numeric
      // string the drizzle numeric column will coerce. The CHECK
      // constraint pins range, so validate finiteness here only.
      const v = body.maxKwOverride;
      if (v === null) {
        patch.maxKwOverride = null;
      } else {
        const num = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(num) || num <= 0 || num > 1000) {
          return new Response(
            JSON.stringify({
              error: "maxKwOverride must be a positive number ≤ 1000, or null",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        // Drizzle's `numeric` column expects a string round-trip to
        // avoid float drift on values like 11.5.
        patch.maxKwOverride = num.toFixed(2);
      }
    }

    if (Object.keys(patch).length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid fields to update" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const result = await db
        .update(chargersCache)
        .set(patch)
        .where(eq(chargersCache.chargeBoxId, chargeBoxId))
        .returning();

      if (result.length === 0) {
        return new Response(
          JSON.stringify({ error: "Charger not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ charger: result[0] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("ChargerAPI", "Failed to update charger", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to update charger" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
