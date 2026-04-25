/**
 * Customer reservations — list + create.
 *
 * GET  /api/customer/reservations
 *   Filtered to the caller's owned tags (`reservations.steve_ocpp_tag_pk IN
 *   scope.ocppTagPks`). Empty scope short-circuits to an empty list.
 *
 * POST /api/customer/reservations
 *   Capability: `reserve` (requires active scope).
 *   Body: { chargeBoxId, connectorId, steveOcppTagPk, startAtIso, endAtIso }
 *   Validation: `steveOcppTagPk` MUST belong to the caller — enforced via
 *   `assertOwnership("card", steveOcppTagPk)` (cards == tags).
 *
 *   On conflict: returns 409 `{ conflicts, suggestions: [windowA, windowB] }`.
 *   `suggestions` are computed by `suggestAlternatives` — at most 2 free
 *   windows of the same duration starting after the existing conflicts. The
 *   UI renders these as one-tap chips.
 */

import { define } from "../../../../utils.ts";
import { and, asc, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from "../../../../src/db/schema.ts";
import {
  createReservation,
  enrichDtosWithFriendlyNames,
  suggestAlternatives,
  toReservationRowDTO,
} from "../../../../src/services/reservation.service.ts";
import {
  assertOwnership,
  OwnershipError,
  resolveCustomerScope,
} from "../../../../src/lib/scoping.ts";
import {
  assertCapability,
  CapabilityDeniedError,
} from "../../../../src/lib/capabilities.ts";
import { logCustomerAction } from "../../../../src/lib/audit.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerReservationsAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseStatuses(raw: string | null): ReservationStatus[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const invalid = parts.filter(
    (p) => !RESERVATION_STATUSES.includes(p as ReservationStatus),
  );
  if (invalid.length > 0) return null;
  return parts as ReservationStatus[];
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const url = new URL(ctx.req.url);
    const statusRaw = url.searchParams.get("status");
    const upcoming = url.searchParams.get("upcoming") === "true";
    const limitRaw = url.searchParams.get("limit");
    const skipRaw = url.searchParams.get("skip");

    const limit = Math.max(
      1,
      Math.min(parseInt(limitRaw ?? "50", 10) || 50, 500),
    );
    const skip = Math.max(0, parseInt(skipRaw ?? "0", 10) || 0);

    const statuses = parseStatuses(statusRaw);
    if (statusRaw && statuses === null) {
      return jsonResponse(400, {
        error: `Invalid status filter. Allowed: ${
          RESERVATION_STATUSES.join(", ")
        }`,
      });
    }

    try {
      const scope = await resolveCustomerScope(ctx);
      if (scope.ocppTagPks.length === 0) {
        return jsonResponse(200, {
          reservations: [],
          total: 0,
          skip,
          limit,
        });
      }

      const clauses = [
        inArray(schema.reservations.steveOcppTagPk, scope.ocppTagPks),
      ];
      if (statuses) {
        clauses.push(inArray(schema.reservations.status, statuses));
      }
      if (upcoming) {
        clauses.push(gte(schema.reservations.endAt, new Date()));
      }

      const whereClause = and(...clauses);

      const rows = await db
        .select()
        .from(schema.reservations)
        .where(whereClause)
        .orderBy(
          upcoming
            ? asc(schema.reservations.startAt)
            : desc(schema.reservations.startAt),
        )
        .offset(skip)
        .limit(limit);

      const [{ value: total }] = await db
        .select({ value: count() })
        .from(schema.reservations)
        .where(whereClause);

      const reservations = await enrichDtosWithFriendlyNames(
        rows.map(toReservationRowDTO),
      );
      return jsonResponse(200, {
        reservations,
        total: Number(total) || 0,
        skip,
        limit,
      });
    } catch (error) {
      log.error("Failed to list customer reservations", error as Error);
      return jsonResponse(500, { error: "Failed to list reservations" });
    }
  },

  async POST(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    // Read-only impersonation: admins may not create reservations on a
    // customer's behalf — they should switch to admin tools for that.
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only while impersonating; use admin tools to mutate.",
      });
    }

    let body: {
      chargeBoxId?: unknown;
      connectorId?: unknown;
      steveOcppTagPk?: unknown;
      startAtIso?: unknown;
      endAtIso?: unknown;
    };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { chargeBoxId, connectorId, steveOcppTagPk, startAtIso, endAtIso } =
      body;

    if (typeof chargeBoxId !== "string" || chargeBoxId.length === 0) {
      return jsonResponse(400, { error: "chargeBoxId is required" });
    }
    if (typeof connectorId !== "number" || !Number.isInteger(connectorId)) {
      return jsonResponse(400, { error: "connectorId must be an integer" });
    }
    if (
      typeof steveOcppTagPk !== "number" || !Number.isInteger(steveOcppTagPk)
    ) {
      return jsonResponse(400, { error: "steveOcppTagPk must be an integer" });
    }
    if (typeof startAtIso !== "string" || typeof endAtIso !== "string") {
      return jsonResponse(400, {
        error: "startAtIso and endAtIso must be ISO strings",
      });
    }

    const startAt = new Date(startAtIso);
    const endAt = new Date(endAtIso);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return jsonResponse(400, { error: "Invalid ISO timestamp" });
    }
    if (!(endAt > startAt)) {
      return jsonResponse(400, { error: "endAt must be after startAt" });
    }

    try {
      await assertCapability(ctx, "reserve");
      // Cards == tags. Throws OwnershipError (404) if not owned.
      await assertOwnership(ctx, "card", steveOcppTagPk);

      // Resolve the OCPP id_tag string + lago subscription from the mapping.
      const [mapping] = await db
        .select({
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
          lagoSubscriptionExternalId:
            schema.userMappings.lagoSubscriptionExternalId,
        })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.steveOcppTagPk, steveOcppTagPk))
        .limit(1);
      if (!mapping) {
        // Should be unreachable — assertOwnership succeeded.
        return jsonResponse(404, { error: "Card not found" });
      }

      const result = await createReservation({
        chargeBoxId,
        connectorId,
        steveOcppTagPk,
        steveOcppIdTag: mapping.steveOcppIdTag,
        lagoSubscriptionExternalId: mapping.lagoSubscriptionExternalId,
        startAt,
        endAt,
        createdByUserId: ctx.state.user.id,
        force: false,
      });

      if (result.conflicts.length > 0) {
        const suggestions = await suggestAlternatives({
          chargeBoxId,
          connectorId,
          requestedStartAt: startAt,
          requestedEndAt: endAt,
          conflicts: result.conflicts,
        });
        return jsonResponse(409, {
          error: "Time window conflicts with existing reservation(s)",
          conflicts: result.conflicts,
          suggestions,
        });
      }

      await logCustomerAction({
        userId: ctx.state.user.id,
        action: "reservation-create",
        route: new URL(ctx.req.url).pathname,
        metadata: {
          reservationId: result.reservation.id,
          chargeBoxId,
          connectorId,
        },
      });

      return jsonResponse(201, {
        reservation: toReservationRowDTO(result.reservation),
      });
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "Account inactive",
          capability: err.capability,
        });
      }
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Card not found" });
      }
      log.error("Failed to create reservation", err as Error);
      return jsonResponse(500, { error: "Failed to create reservation" });
    }
  },
});
