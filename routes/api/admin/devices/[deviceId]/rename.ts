/**
 * ExpresScan / Wave 2 Track B-admin — admin device rename.
 *
 * POST /api/admin/devices/{deviceId}/rename
 *   Body: { label: string }   // 1..80 chars after trim
 *
 * Updates the human-friendly label that surfaces in admin lists, the
 * scan-target picker, and the device's own UI. Soft-deleted devices can
 * still be renamed (admins occasionally relabel deregistered rows for
 * forensic clarity), so the WHERE clause does not exclude them.
 *
 * Auth: admin cookie. Idempotent via `withIdempotency`.
 *
 * Errors:
 *   401 — not admin
 *   404 — no device with that id
 *   400 — missing/invalid label
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices } from "../../../../../src/db/schema.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceRename");

const ROUTE = "/api/admin/devices/{deviceId}/rename";
const MAX_LABEL_LENGTH = 80;

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

function badRequest(error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return unauthorized();
    }
    const deviceId = ctx.params.deviceId;
    if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
      return notFound();
    }

    return await withIdempotency(ctx, ROUTE, async () => {
      let body: { label?: unknown };
      try {
        body = await ctx.req.json();
      } catch {
        return badRequest("invalid_json");
      }

      if (typeof body.label !== "string") {
        return badRequest("invalid_label");
      }
      const label = body.label.trim();
      if (label.length === 0) {
        return badRequest("label_empty");
      }
      if (label.length > MAX_LABEL_LENGTH) {
        return badRequest(`label_too_long: max ${MAX_LABEL_LENGTH}`);
      }

      try {
        const updated = await db
          .update(devices)
          .set({ label })
          .where(eq(devices.id, deviceId))
          .returning({ id: devices.id });

        if (updated.length === 0) {
          return notFound();
        }

        return new Response(
          JSON.stringify({ ok: true, label }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      } catch (err) {
        log.error("Failed to rename device", {
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
