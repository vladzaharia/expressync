/**
 * PATCH + DELETE /api/admin/charger/{chargeBoxId}/connectors/{connectorId}.
 *
 * PATCH updates the connector spec (`connectorType`, `maxKw`). DELETE
 * removes the row, but rejects with 409 when StEvE reports an active
 * transaction on this connector — admins must stop the session before
 * removing the connector. The UI also disables the `×` in that state;
 * the server check is defense-in-depth (the UI may be stale).
 */

import { define } from "../../../../../../utils.ts";
import {
  deleteConnector,
  updateConnectorSpec,
} from "../../../../../../src/services/charger-connectors.service.ts";
import { isConnectorType } from "../../../../../../src/lib/types/connectors.ts";
import { logger } from "../../../../../../src/lib/utils/logger.ts";
import { steveClient } from "../../../../../../src/lib/steve-client.ts";

export const handler = define.handlers({
  async PATCH(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(404, { error: "not_found" });
    }

    const chargeBoxId = ctx.params.chargeBoxId;
    const connectorId = Number(ctx.params.connectorId);
    if (!chargeBoxId || !Number.isInteger(connectorId) || connectorId < 0) {
      return jsonResponse(400, { error: "invalid_path_params" });
    }

    let body: Record<string, unknown>;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const patch: { connectorType?: string | null; maxKw?: number | null } = {};

    if ("connectorType" in body) {
      if (body.connectorType === null) {
        patch.connectorType = null;
      } else if (isConnectorType(body.connectorType)) {
        patch.connectorType = body.connectorType;
      } else {
        return jsonResponse(400, {
          error:
            "connectorType must be one of: ccs, j1772, nacs, chademo, type2 — or null",
        });
      }
    }

    if ("maxKw" in body) {
      if (body.maxKw === null) {
        patch.maxKw = null;
      } else {
        const num = typeof body.maxKw === "number"
          ? body.maxKw
          : Number(body.maxKw);
        if (!Number.isFinite(num) || num <= 0 || num > 1000) {
          return jsonResponse(400, {
            error: "maxKw must be a positive number ≤ 1000, or null",
          });
        }
        patch.maxKw = num;
      }
    }

    if (Object.keys(patch).length === 0) {
      return jsonResponse(400, { error: "no_fields" });
    }

    try {
      const updated = await updateConnectorSpec(
        chargeBoxId,
        connectorId,
        patch,
      );
      if (!updated) {
        return jsonResponse(404, { error: "connector_not_found" });
      }
      return jsonResponse(200, { connector: updated });
    } catch (err) {
      logger.error(
        "ChargerConnectors.patch",
        "Failed to update connector spec",
        err as Error,
      );
      return jsonResponse(500, { error: "update_failed" });
    }
  },

  async DELETE(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return jsonResponse(404, { error: "not_found" });
    }

    const chargeBoxId = ctx.params.chargeBoxId;
    const connectorId = Number(ctx.params.connectorId);
    if (!chargeBoxId || !Number.isInteger(connectorId) || connectorId < 0) {
      return jsonResponse(400, { error: "invalid_path_params" });
    }

    // Guard: refuse to remove a connector with an active StEvE
    // transaction. Best-effort — if StEvE is unreachable, allow the
    // delete to proceed (the UI also disables the affordance, so this
    // is a secondary check).
    try {
      const active = await steveClient.getTransactions({
        chargeBoxId,
        type: "ACTIVE",
        periodType: "ALL",
      });
      const hit = active.find((t) => t.connectorId === connectorId);
      if (hit) {
        return jsonResponse(409, {
          error: "active_session",
          message:
            `Connector ${connectorId} has an active session (#${hit.id}). Stop it before removing the connector.`,
        });
      }
    } catch (err) {
      logger.warn(
        "ChargerConnectors.delete",
        "StEvE active-session check failed; allowing delete",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }

    try {
      const removed = await deleteConnector(chargeBoxId, connectorId);
      if (!removed) {
        return jsonResponse(404, { error: "connector_not_found" });
      }
      return jsonResponse(200, { ok: true });
    } catch (err) {
      logger.error(
        "ChargerConnectors.delete",
        "Failed to delete connector",
        err as Error,
      );
      return jsonResponse(500, { error: "delete_failed" });
    }
  },
});

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
