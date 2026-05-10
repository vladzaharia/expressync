/**
 * POST /api/admin/charger/{chargeBoxId}/connectors — add a connector to
 * a charger. Used by the admin detail page's "+ Add connector" inline
 * form. PK conflicts (duplicate connectorId) return 409.
 */

import { define } from "../../../../../../utils.ts";
import {
  createConnector,
} from "../../../../../../src/services/charger-connectors.service.ts";
import { isConnectorType } from "../../../../../../src/lib/types/connectors.ts";
import { logger } from "../../../../../../src/lib/utils/logger.ts";

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(404, { error: "not_found" });
    }

    const chargeBoxId = ctx.params.chargeBoxId;
    if (!chargeBoxId) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }

    let body: Record<string, unknown>;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const connectorIdRaw = body.connectorId;
    const connectorId = typeof connectorIdRaw === "number"
      ? connectorIdRaw
      : Number(connectorIdRaw);
    if (
      !Number.isInteger(connectorId) || connectorId < 0 || connectorId > 9999
    ) {
      return jsonResponse(400, {
        error: "connectorId must be a non-negative integer",
      });
    }

    let connectorType: string | null = null;
    if (body.connectorType !== undefined && body.connectorType !== null) {
      if (!isConnectorType(body.connectorType)) {
        return jsonResponse(400, {
          error:
            "connectorType must be one of: ccs, j1772, nacs, chademo, type2 — or null",
        });
      }
      connectorType = body.connectorType;
    }

    let maxKw: number | null = null;
    if (body.maxKw !== undefined && body.maxKw !== null) {
      const num = typeof body.maxKw === "number"
        ? body.maxKw
        : Number(body.maxKw);
      if (!Number.isFinite(num) || num <= 0 || num > 1000) {
        return jsonResponse(400, {
          error: "maxKw must be a positive number ≤ 1000, or null",
        });
      }
      maxKw = num;
    }

    try {
      const inserted = await createConnector({
        chargeBoxId,
        connectorId,
        connectorType,
        maxKw: maxKw !== null ? maxKw.toFixed(2) : null,
      });
      if (!inserted) {
        return jsonResponse(409, {
          error: "connector_exists",
          message: `Connector ${connectorId} already exists for this charger`,
        });
      }
      return jsonResponse(201, { connector: inserted });
    } catch (err) {
      logger.error(
        "ChargerConnectors.create",
        "Failed to create connector",
        err as Error,
      );
      return jsonResponse(500, { error: "create_failed" });
    }
  },
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
