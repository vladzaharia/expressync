/**
 * ExpresScan v2 / Wave 6 Slice J — admin charger remote-stop.
 *
 * POST /api/admin/devices/{deviceId}/stop
 *
 * Bearer-auth'd device-API endpoint. Mirrors the customer-portal
 * `/api/customer/session-stop` flow but is keyed by chargeBoxId. The
 * caller usually omits `transactionPk` — we look up the active session
 * on the charger via StEvE's `getTransactions(chargeBoxId, type=ACTIVE)`
 * and stop that one. Friends-and-family scope: any device with `user`
 * may stop any session.
 *
 * Body (strict):
 *   { transactionPk?: number | null }
 *
 * Pre-flight rejections:
 *   401 unauthorized          — no bearer
 *   403 capability_denied     — caller lacks `user`
 *   400 invalid_body          — body fails the strict schema
 *   404 charger_not_found     — charger unknown to `chargers`
 *   404 no_active_transaction — no active StEvE transaction on the charger
 *                              (after offline preflight passed; this is
 *                              the "charger is online but idle" case)
 *   409 charger_offline       — `lastStatusAt` outside the 90 s window
 *
 * Idempotency: wraps in `withIdempotency`.
 * Audit: `device.user.stop_charge`.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { chargerOperationLog } from "../../../../../src/db/schema.ts";
import { steveClient } from "../../../../../src/lib/steve-client.ts";
import { RemoteStopTransactionParamsSchema } from "../../../../../src/lib/types/steve.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../../../src/lib/devices/capability-gate.ts";
import {
  ChargerNotFoundError,
  ChargerOfflineError,
  requireOnlineCharger,
} from "../../../../../src/lib/chargers/online.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logDeviceUserStopCharge } from "../../../../../src/lib/audit.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";
import type { StEvETransaction } from "../../../../../src/lib/types/steve.ts";

const log = logger.child("AdminDeviceChargerStop");

const ROUTE = "/api/admin/devices/[deviceId]/stop";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const StopBodySchema = z.object({
  transactionPk: z.number().int().positive().nullable().optional(),
}).strict();

export type StopBody = z.infer<typeof StopBodySchema>;

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

type ActiveTxnFinder = (
  chargeBoxId: string,
) => Promise<StEvETransaction | null>;
type SteveStopper = typeof steveClient.operations.remoteStop;

const defaultActiveTxnFinder: ActiveTxnFinder = async (chargeBoxId) => {
  const txs = await steveClient.getTransactions({
    chargeBoxId,
    type: "ACTIVE",
  });
  return txs[0] ?? null;
};

const defaultSteveStopper: SteveStopper = (params) =>
  steveClient.operations.remoteStop(params);

let activeTxnFinder: ActiveTxnFinder = defaultActiveTxnFinder;
let steveStopper: SteveStopper = defaultSteveStopper;

export function _setActiveTxnFinderForTests(
  fn: ActiveTxnFinder | null,
): void {
  activeTxnFinder = fn ?? defaultActiveTxnFinder;
}
export function _setSteveStopperForTests(fn: SteveStopper | null): void {
  steveStopper = fn ?? defaultSteveStopper;
}
export function _resetStopTestSeams(): void {
  activeTxnFinder = defaultActiveTxnFinder;
  steveStopper = defaultSteveStopper;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = define.handlers({
  POST(ctx) {
    return withIdempotency(ctx, ROUTE, async () => {
      if (!ctx.state.device) {
        return jsonResponse(401, { error: "unauthorized" });
      }
      try {
        await requireCapability(ctx, "user");
      } catch (err) {
        if (err instanceof CapabilityDeniedError) {
          return jsonResponse(403, {
            error: "capability_denied",
            missing: err.missing,
          });
        }
        throw err;
      }

      const chargerId = ctx.params.deviceId;
      if (!chargerId || chargerId.length === 0) {
        return jsonResponse(404, { error: "charger_not_found" });
      }

      let body: StopBody = {};
      try {
        const text = await ctx.req.text();
        if (text.trim() !== "") {
          const parsed = StopBodySchema.safeParse(JSON.parse(text));
          if (!parsed.success) {
            return jsonResponse(400, {
              error: "invalid_body",
              details: parsed.error.issues,
            });
          }
          body = parsed.data;
        }
      } catch {
        return jsonResponse(400, { error: "invalid_body" });
      }

      // ---- charger online preflight ----
      try {
        await requireOnlineCharger(chargerId);
      } catch (err) {
        if (err instanceof ChargerNotFoundError) {
          return jsonResponse(404, { error: "charger_not_found" });
        }
        if (err instanceof ChargerOfflineError) {
          return jsonResponse(409, {
            error: "charger_offline",
            lastSeenAt: err.lastSeenAt ? err.lastSeenAt.toISOString() : null,
          });
        }
        log.error("Charger preflight failed", {
          chargerId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }

      // ---- resolve transactionId ----
      let transactionId: number;
      if (body.transactionPk !== null && body.transactionPk !== undefined) {
        transactionId = body.transactionPk;
      } else {
        let active: StEvETransaction | null = null;
        try {
          active = await activeTxnFinder(chargerId);
        } catch (err) {
          log.error("Active-txn lookup failed", {
            chargerId,
            error: err instanceof Error ? err.message : String(err),
          });
          return jsonResponse(502, { error: "steve_unreachable" });
        }
        if (!active) {
          return jsonResponse(404, { error: "no_active_transaction" });
        }
        transactionId = active.id;
      }

      const validated = RemoteStopTransactionParamsSchema.safeParse({
        chargeBoxId: chargerId,
        transactionId,
      });
      if (!validated.success) {
        return jsonResponse(400, {
          error: "invalid_body",
          details: validated.error.issues,
        });
      }

      const callerDeviceId = ctx.state.device.id;
      const callerOwnerUserId = ctx.state.device.ownerUserId;

      let logRow: { id: number };
      try {
        const inserted = await db
          .insert(chargerOperationLog)
          .values({
            chargeBoxId: chargerId,
            operation: "RemoteStopTransaction",
            params: validated.data,
            requestedByUserId: callerOwnerUserId,
            status: "pending",
          })
          .returning();
        logRow = inserted[0];
      } catch (err) {
        log.error("operation-log INSERT failed", {
          chargerId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }

      try {
        const result = await steveStopper(validated.data);
        const [updated] = await db
          .update(chargerOperationLog)
          .set({
            taskId: result.taskId,
            status: "submitted",
            result: result as unknown as Record<string, unknown>,
          })
          .where(eq(chargerOperationLog.id, logRow.id))
          .returning();

        void logDeviceUserStopCharge({
          userId: callerOwnerUserId,
          route: ROUTE,
          metadata: {
            deviceId: callerDeviceId,
            chargerId,
            transactionId,
            operationLogId: updated.id,
          },
        });

        return jsonResponse(200, {
          operationLogId: updated.id,
          taskId: updated.taskId,
          status: updated.status,
        });
      } catch (steveErr) {
        const message = steveErr instanceof Error
          ? steveErr.message
          : String(steveErr);
        log.error("StEvE RemoteStop failed", { chargerId, error: message });
        try {
          await db
            .update(chargerOperationLog)
            .set({
              status: "failed",
              result: { error: message },
              completedAt: new Date(),
            })
            .where(eq(chargerOperationLog.id, logRow.id));
        } catch {
          // best-effort
        }
        return jsonResponse(502, {
          operationLogId: logRow.id,
          status: "failed",
          error: "Charger could not stop the session. Please try again.",
        });
      }
    });
  },
});
