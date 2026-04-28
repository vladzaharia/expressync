/**
 * ExpresScan v2 / Wave 6 Slice J — admin charger remote-start.
 *
 * POST /api/admin/devices/{deviceId}/start
 *
 * Bearer-auth'd device-API endpoint. Mirrors the customer-portal
 * `/api/customer/remote-start` flow but is keyed by chargeBoxId (the
 * charger we want to start) and accepts an explicit `idTag` / `tagPk`
 * picked by the iOS Tag Picker sheet — there is no per-caller "primary
 * card" lookup. Per slice J's friends-and-family scope, any device with
 * the `user` capability can start a charge against any charger; per-row
 * owner gating is a future PR.
 *
 * `[deviceId]` here is the **charger** id, not the caller's app device id.
 * Wire-shape consistency with the rest of the `/api/admin/devices/{id}/*`
 * surface — even though the URL says "devices", chargers and apps both
 * live behind it.
 *
 * Body (strict — unknown keys rejected):
 *   { idTag: string, tagPk: number, reservationId?: string | null }
 *
 * Pre-flight rejections:
 *   401 unauthorized        — no bearer / no `ctx.state.device`
 *   403 capability_denied   — caller lacks `user` capability
 *   400 invalid_body        — body fails the strict Zod schema
 *   404 charger_not_found   — `chargeBoxId` not in `chargers_cache`
 *   409 charger_offline     — `lastStatusAt` outside the 90 s window
 *
 * Idempotency: wraps in `withIdempotency`. A retry with the same
 * `Idempotency-Key` returns the cached response without re-firing the
 * StEvE call or audit row.
 *
 * Audit: `device.user.start_charge` with `{ deviceId (caller), chargerId,
 * idTag, reservationId? }`.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { chargerOperationLog } from "../../../../../src/db/schema.ts";
import { steveClient } from "../../../../../src/lib/steve-client.ts";
import { RemoteStartTransactionParamsSchema } from "../../../../../src/lib/types/steve.ts";
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
import { logDeviceUserStartCharge } from "../../../../../src/lib/audit.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceChargerStart");

const ROUTE = "/api/admin/devices/[deviceId]/start";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const StartBodySchema = z.object({
  idTag: z.string().min(1),
  tagPk: z.number().int().positive(),
  reservationId: z.string().min(1).nullable().optional(),
}).strict();

export type StartBody = z.infer<typeof StartBodySchema>;

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

type SteveStarter = typeof steveClient.operations.remoteStart;

const defaultSteveStarter: SteveStarter = (params) =>
  steveClient.operations.remoteStart(params);

let steveStarter: SteveStarter = defaultSteveStarter;

export function _setSteveStarterForTests(fn: SteveStarter | null): void {
  steveStarter = fn ?? defaultSteveStarter;
}
export function _resetStartTestSeams(): void {
  steveStarter = defaultSteveStarter;
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

      // ---- body ----
      let body: StartBody;
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") {
          return jsonResponse(400, { error: "invalid_body" });
        }
        const raw = JSON.parse(text);
        const parsed = StartBodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(400, {
            error: "invalid_body",
            details: parsed.error.issues,
          });
        }
        body = parsed.data;
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

      // ---- StEvE RemoteStart ----
      const validated = RemoteStartTransactionParamsSchema.safeParse({
        chargeBoxId: chargerId,
        idTag: body.idTag,
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
            operation: "RemoteStartTransaction",
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
        const result = await steveStarter(validated.data);
        const [updated] = await db
          .update(chargerOperationLog)
          .set({
            taskId: result.taskId,
            status: "submitted",
            result: result as unknown as Record<string, unknown>,
          })
          .where(eq(chargerOperationLog.id, logRow.id))
          .returning();

        void logDeviceUserStartCharge({
          userId: callerOwnerUserId,
          route: ROUTE,
          metadata: {
            deviceId: callerDeviceId,
            chargerId,
            idTag: body.idTag,
            tagPk: body.tagPk,
            reservationId: body.reservationId ?? null,
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
        log.error("StEvE RemoteStart failed", { chargerId, error: message });
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
          // best-effort log update
        }
        return jsonResponse(502, {
          operationLogId: logRow.id,
          status: "failed",
          error: "Charger could not start the session. Please try again.",
        });
      }
    });
  },
});
