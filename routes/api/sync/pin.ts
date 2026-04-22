import { define } from "../../../utils.ts";
import { z } from "zod";
import { db } from "../../../src/db/index.ts";
import { syncScheduleState } from "../../../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { logger } from "../../../src/lib/utils/logger.ts";

/**
 * POST /api/sync/pin
 *
 * Admin-only. Pins the scheduler to a specific tier for N hours.
 * Body: { tier: "active"|"idle"|"dormant", hours: number (1-336) }
 *
 * DELETE /api/sync/pin
 * Admin-only. Clears any active pin.
 *
 * The middleware already gates /api/sync/* to admins, but we double-check
 * here as defense-in-depth.
 */

const PinBodySchema = z.object({
  tier: z.enum(["active", "idle", "dormant"]),
  hours: z.number().int().min(1).max(24 * 14),
});

function forbidden(): Response {
  return new Response(
    JSON.stringify({ error: "Forbidden: admin access required" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user?.role !== "admin") return forbidden();

    let body: z.infer<typeof PinBodySchema>;
    try {
      const raw = await ctx.req.json();
      body = PinBodySchema.parse(raw);
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Invalid body",
          details: error instanceof Error ? error.message : String(error),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      await db.update(syncScheduleState).set({
        pinnedTier: body.tier,
        pinnedUntil: sql`now() + (${body.hours}::int || ' hours')::interval`,
      }).where(eq(syncScheduleState.id, 1));

      logger.info("API", "Scheduler tier pinned", {
        tier: body.tier,
        hours: body.hours,
        userId: ctx.state.user?.id,
      });

      return new Response(
        JSON.stringify({
          message: `Tier pinned to ${body.tier} for ${body.hours}h`,
          tier: body.tier,
          hours: body.hours,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("API", "Failed to pin tier", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to pin tier" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  async DELETE(ctx) {
    if (ctx.state.user?.role !== "admin") return forbidden();

    try {
      await db.update(syncScheduleState).set({
        pinnedTier: null,
        pinnedUntil: null,
      }).where(eq(syncScheduleState.id, 1));

      logger.info("API", "Scheduler tier pin cleared", {
        userId: ctx.state.user?.id,
      });

      return new Response(
        JSON.stringify({ message: "Pin cleared" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("API", "Failed to clear pin", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to clear pin" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});
