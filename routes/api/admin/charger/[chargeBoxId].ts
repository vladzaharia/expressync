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

    if ("locationDescription" in body) {
      // Free-text location ("North lot, level 2") on unmanaged chargers.
      // OCPP chargers can technically receive a value too — harmless, just
      // unused by the OCPP detail surfaces.
      const v = body.locationDescription;
      if (v !== null && (typeof v !== "string" || v.length > 500)) {
        return new Response(
          JSON.stringify({
            error: "locationDescription must be string ≤500 chars or null",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      patch.locationDescription = v;
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

    // Structured address fields. All optional; null clears the column.
    // Country is ISO 3166-1 alpha-2 — pinned by both the JS regex below
    // and the DB CHECK constraint added in migration 0046.
    for (
      const key of [
        "addressLine1",
        "addressLine2",
        "addressCity",
        "addressRegion",
        "addressPostalCode",
      ] as const
    ) {
      if (key in body) {
        const v = body[key];
        if (v !== null && (typeof v !== "string" || v.length > 200)) {
          return new Response(
            JSON.stringify({
              error: `${key} must be string ≤200 chars or null`,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        patch[key] = v;
      }
    }
    if ("addressCountry" in body) {
      const v = body.addressCountry;
      if (v !== null && (typeof v !== "string" || !/^[A-Z]{2}$/.test(v))) {
        return new Response(
          JSON.stringify({
            error:
              "addressCountry must be ISO 3166-1 alpha-2 (e.g. 'US') or null",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      patch.addressCountry = v;
    }
    for (const key of ["latitude", "longitude"] as const) {
      if (key in body) {
        const v = body[key];
        if (v === null) {
          patch[key] = null;
        } else {
          const num = typeof v === "number" ? v : Number(v);
          const max = key === "latitude" ? 90 : 180;
          if (!Number.isFinite(num) || Math.abs(num) > max) {
            return new Response(
              JSON.stringify({
                error:
                  `${key} must be a finite number in [${-max}, ${max}] or null`,
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          // Numeric column → string round-trip to preserve precision.
          patch[key] = num.toFixed(6);
        }
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
