/**
 * POST /api/customer/cards/[id]/report-lost
 *
 * Customer self-service: marks an EV card as lost so it can no longer
 * authorize a charging session. Three things happen atomically (best
 * effort — failures degrade rather than block):
 *
 *   1. `user_mappings.isActive` is flipped to false locally.
 *   2. The next sync run will push the deactivation to StEvE
 *      (`maxActiveTransactionCount = 0`) so the charger refuses the tag.
 *      We also fire a one-shot inline `syncSingleTagToSteve` here so
 *      operators don't have to wait the 15-minute cadence.
 *   3. An admin notification is created (severity=warn) for follow-up
 *      (issue replacement card, refund any disputed sessions, etc.).
 *
 * Idempotent: a second call on an already-inactive card returns 200
 * with `alreadyInactive: true` and skips the notification. The Lago
 * subscription is *not* cancelled — that's an operator decision.
 *
 * Security: ownership is enforced via `assertOwnership("card", id)`.
 * Read-only impersonation rejects POSTs (handled by middleware).
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import * as schema from "../../../../../src/db/schema.ts";
import {
  assertOwnership,
  OwnershipError,
} from "../../../../../src/lib/scoping.ts";
import { syncSingleTagToSteve } from "../../../../../src/services/tag-sync.service.ts";
import { stopActiveTransactionsForMappings } from "../../../../../src/services/auto-stop.service.ts";
import { createNotification } from "../../../../../src/services/notification.service.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("ReportLostCardAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Body {
  /** Optional free-text reason ("dropped at coffee shop"). Surfaced on the admin notification. */
  reason?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) return jsonResponse(401, { error: "Unauthorized" });
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only impersonation cannot report cards",
      });
    }
    const id = parseInt(ctx.params.id ?? "", 10);
    if (!Number.isFinite(id) || id <= 0) {
      return jsonResponse(400, { error: "Invalid id" });
    }

    try {
      await assertOwnership(ctx, "card", id);
    } catch (err) {
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Card not found" });
      }
      log.error("Ownership check threw", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    let body: Body = {};
    try {
      const raw = await ctx.req.text();
      if (raw) body = JSON.parse(raw) as Body;
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const reason = typeof body.reason === "string"
      ? body.reason.slice(0, 280).trim()
      : "";

    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, id))
      .limit(1);
    if (!mapping) return jsonResponse(404, { error: "Card not found" });

    if (!mapping.isActive) {
      return jsonResponse(200, { ok: true, alreadyInactive: true });
    }

    try {
      await db
        .update(schema.userMappings)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.userMappings.id, id));
    } catch (err) {
      log.error("Failed to deactivate mapping locally", {
        mappingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "Failed to deactivate card" });
    }

    // Push to StEvE inline so the charger refuses the tag right away.
    // Best-effort — the next sync sweep is the safety net if this fails.
    try {
      await syncSingleTagToSteve({ ...mapping, isActive: false });
    } catch (err) {
      log.warn("Inline syncSingleTagToSteve failed; sync sweep will retry", {
        mappingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Wave R: if a session is already in flight on this card, stop it
    // immediately. The customer almost certainly didn't intend to keep
    // accruing charges on a card they just reported lost.
    void stopActiveTransactionsForMappings([id], {
      code: "card_reported_lost",
      detail: reason
        ? `Card reported lost by customer: ${reason}`
        : "Card reported lost by customer",
    }).catch((err) => {
      log.warn("Auto-stop on report-lost failed (non-fatal)", {
        mappingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Append a row to tag_change_log for audit trail.
    try {
      await db.insert(schema.tagChangeLog).values({
        ocppTagPk: mapping.steveOcppTagPk,
        idTag: mapping.steveOcppIdTag,
        changeType: "deactivated",
        before: { isActive: true },
        after: {
          isActive: false,
          reason: "customer_reported_lost",
          customerReason: reason || null,
          actorUserId: ctx.state.user.id,
        },
      });
    } catch (err) {
      log.warn("Failed to write tag_change_log entry", {
        mappingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Notify admins. Best-effort.
    try {
      await createNotification({
        kind: "card.lost",
        severity: "warn",
        title: `Card reported lost: ${
          mapping.displayName?.trim() || mapping.steveOcppIdTag
        }`,
        body: reason
          ? `Customer reported card ${mapping.steveOcppIdTag} as lost. Reason: ${reason}`
          : `Customer reported card ${mapping.steveOcppIdTag} as lost.`,
        // No "tag" sourceType in NotificationSourceType — leave unset.
        // The body text + admin's notification panel link by id is enough.
        sourceId: String(mapping.steveOcppTagPk),
        adminUserId: null,
      });
    } catch (err) {
      log.warn("Failed to create admin notification", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return jsonResponse(200, { ok: true, alreadyInactive: false });
  },
});
