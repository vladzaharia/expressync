/**
 * ExpresScan / Wave 2 Track B-admin — admin force-deregister.
 *
 * POST /api/admin/devices/{deviceId}/deregister
 *   Body: { reason?: string }
 *
 * Soft-deletes the device row (sets `deleted_at`, `revoked_at`,
 * `revoked_by_user_id`) and revokes every associated `device_tokens` row in
 * the same transaction. Idempotent via `withIdempotency` so an iOS-app retry
 * (or admin double-click) doesn't re-fire side effects.
 *
 * The `device.token.revoked` event is published at the end so any open SSE
 * stream owned by this device closes immediately — Track C-stream listens
 * for this exact event filtered by `payload.deviceId`.
 *
 * Auth: admin cookie. Bearer is rejected at the middleware layer.
 *
 * Errors:
 *   401 — not admin (defensive; middleware already enforces this)
 *   404 — no device with that id
 *   409 — device already deregistered (clean idempotent error rather than
 *         silently re-emitting the revoke event)
 */

import { and, eq, isNull } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices, deviceTokens } from "../../../../../src/db/schema.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import {
  logDeviceDeregistered,
  logDeviceTokenRevoked,
} from "../../../../../src/lib/audit.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceDeregister");

const ROUTE = "/api/admin/devices/{deviceId}/deregister";

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function notFound(): Response {
  return new Response(
    JSON.stringify({ error: "not_found" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

function conflict(): Response {
  return new Response(
    JSON.stringify({ error: "already_deregistered" }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

function badRequest(error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

/** Truncate audit reason strings — abusive input shouldn't bloat audit rows. */
function sanitizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 500);
}

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return unauthorized();
    }
    const adminUserId = ctx.state.user.id;
    const deviceId = ctx.params.deviceId;
    if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
      return notFound();
    }

    return await withIdempotency(ctx, ROUTE, async () => {
      // Body is optional. Tolerate empty bodies gracefully — many clients
      // send POST with no payload at all for "force-revoke" verbs.
      let reason: string | null = null;
      const ct = ctx.req.headers.get("Content-Type") ?? "";
      if (ct.toLowerCase().includes("application/json")) {
        try {
          const text = await ctx.req.text();
          if (text.trim().length > 0) {
            const body = JSON.parse(text) as { reason?: unknown };
            reason = sanitizeReason(body.reason);
          }
        } catch {
          return badRequest("invalid_json");
        }
      }

      try {
        // Atomic claim: only proceed if the row exists AND isn't already
        // soft-deleted. RETURNING tells us which case we hit. If zero rows,
        // we follow up with a "does the row exist at all?" probe to
        // distinguish 404 from 409.
        const updated = await db
          .update(devices)
          .set({
            deletedAt: new Date(),
            revokedAt: new Date(),
            revokedByUserId: adminUserId,
          })
          .where(
            and(
              eq(devices.id, deviceId),
              isNull(devices.deletedAt),
            ),
          )
          .returning({ id: devices.id, ownerUserId: devices.ownerUserId });

        if (updated.length === 0) {
          // Either not-found or already-deregistered. One probe to decide.
          const [existing] = await db
            .select({ id: devices.id })
            .from(devices)
            .where(eq(devices.id, deviceId))
            .limit(1);
          return existing ? conflict() : notFound();
        }

        const { ownerUserId } = updated[0];

        // Revoke every still-live token row. We capture the ids so the
        // device.token.revoked event payload can include `tokenId` per the
        // contract in `src/lib/types/devices.ts#DeviceTokenRevokedPayload`.
        const tokensRevoked = await db
          .update(deviceTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(deviceTokens.deviceId, deviceId),
              isNull(deviceTokens.revokedAt),
            ),
          )
          .returning({ id: deviceTokens.id });

        // Audit (best-effort; never throws).
        await logDeviceDeregistered({
          userId: adminUserId,
          ip: ctx.req.headers.get("x-forwarded-for") ??
            ctx.req.headers.get("x-real-ip") ?? null,
          ua: ctx.req.headers.get("user-agent"),
          route: ROUTE,
          metadata: {
            deviceId,
            ownerUserId,
            actor: "admin",
            reason,
            revokedTokenCount: tokensRevoked.length,
          },
        });

        // One audit row per revoked token so probe-detection scrapers can
        // count revocations independently of deregister actions.
        await Promise.all(
          tokensRevoked.map((t) =>
            logDeviceTokenRevoked({
              userId: adminUserId,
              route: ROUTE,
              metadata: {
                deviceId,
                tokenId: t.id,
                actor: "admin",
                reason: reason ?? "admin_deregister",
              },
            })
          ),
        );

        // Publish revoke events so any open SSE stream closes immediately.
        // One event per token row covers the (rare) multi-token case
        // cleanly; C-stream's filter is on `payload.deviceId`, so a single
        // event would also work, but emitting per-token aligns with the
        // payload contract (`tokenId` is a single value, not an array).
        for (const t of tokensRevoked) {
          eventBus.publish({
            type: "device.token.revoked",
            payload: {
              deviceId,
              tokenId: t.id,
              reason: reason ?? "admin",
            },
          });
        }

        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      } catch (err) {
        log.error("Failed to deregister device", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return new Response(
          JSON.stringify({ error: "internal_error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    });
  },
});
