/**
 * Reservations API — GET list, POST create.
 *
 * Query filters (all optional):
 *   chargeBoxId     — filter by charger
 *   tagPk           — filter by steve_ocpp_tag_pk
 *   subscriptionId  — filter by lago_subscription_external_id
 *   status          — comma-separated `ReservationStatus` list
 *   upcoming=true   — only rows with end_at >= now()
 *   limit           — 1..500 (default 50)
 *
 * POST body (JSON):
 *   chargeBoxId, connectorId, steveOcppTagPk, steveOcppIdTag,
 *   lagoSubscriptionExternalId?, startAtIso, endAtIso, force?
 */

import { define } from "../../../../utils.ts";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from "../../../../src/db/schema.ts";
import {
  createReservation,
  toReservationRowDTO,
  enrichDtosWithFriendlyNames,
} from "../../../../src/services/reservation.service.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

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
    const url = new URL(ctx.req.url);
    const chargeBoxId = url.searchParams.get("chargeBoxId");
    const tagPkRaw = url.searchParams.get("tagPk");
    const subscriptionId = url.searchParams.get("subscriptionId");
    const statusRaw = url.searchParams.get("status");
    const upcoming = url.searchParams.get("upcoming") === "true";
    const limitRaw = url.searchParams.get("limit");

    const limit = Math.max(
      1,
      Math.min(parseInt(limitRaw ?? "50", 10) || 50, 500),
    );

    const statuses = parseStatuses(statusRaw);
    if (statusRaw && statuses === null) {
      return jsonResponse(400, {
        error: `Invalid status filter. Allowed: ${
          RESERVATION_STATUSES.join(", ")
        }`,
      });
    }

    const tagPk = tagPkRaw ? parseInt(tagPkRaw, 10) : null;
    if (tagPkRaw && (tagPk === null || Number.isNaN(tagPk))) {
      return jsonResponse(400, { error: "tagPk must be an integer" });
    }

    const clauses = [];
    if (chargeBoxId) {
      clauses.push(eq(schema.reservations.chargeBoxId, chargeBoxId));
    }
    if (tagPk !== null) {
      clauses.push(eq(schema.reservations.steveOcppTagPk, tagPk));
    }
    if (subscriptionId) {
      clauses.push(
        eq(schema.reservations.lagoSubscriptionExternalId, subscriptionId),
      );
    }
    if (statuses) {
      clauses.push(inArray(schema.reservations.status, statuses));
    }
    if (upcoming) {
      clauses.push(gte(schema.reservations.endAt, new Date()));
    }

    try {
      const q = db.select().from(schema.reservations);
      const whereApplied = clauses.length > 0 ? q.where(and(...clauses)) : q;
      // Upcoming first (ascending start), otherwise most recent first.
      const rows = await whereApplied
        .orderBy(
          upcoming
            ? asc(schema.reservations.startAt)
            : desc(schema.reservations.startAt),
        )
        .limit(limit);

      const [{ value: total }] = clauses.length > 0
        ? await db
          .select({ value: sql<number>`count(*)` })
          .from(schema.reservations)
          .where(and(...clauses))
        : await db
          .select({ value: sql<number>`count(*)` })
          .from(schema.reservations);

      const reservations = await enrichDtosWithFriendlyNames(
        rows.map(toReservationRowDTO),
      );
      return jsonResponse(200, {
        reservations,
        total: Number(total) || 0,
      });
    } catch (error) {
      logger.error(
        "ReservationsAPI",
        "Failed to list reservations",
        error as Error,
      );
      return jsonResponse(500, { error: "Failed to list reservations" });
    }
  },

  async POST(ctx) {
    let body: {
      chargeBoxId?: unknown;
      connectorId?: unknown;
      steveOcppTagPk?: unknown;
      steveOcppIdTag?: unknown;
      lagoSubscriptionExternalId?: unknown;
      startAtIso?: unknown;
      endAtIso?: unknown;
      force?: unknown;
    };

    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const {
      chargeBoxId,
      connectorId,
      steveOcppTagPk,
      steveOcppIdTag,
      lagoSubscriptionExternalId,
      startAtIso,
      endAtIso,
      force,
    } = body;

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
    if (typeof steveOcppIdTag !== "string" || steveOcppIdTag.length === 0) {
      return jsonResponse(400, { error: "steveOcppIdTag is required" });
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
      const result = await createReservation({
        chargeBoxId,
        connectorId,
        steveOcppTagPk,
        steveOcppIdTag,
        lagoSubscriptionExternalId:
          typeof lagoSubscriptionExternalId === "string"
            ? lagoSubscriptionExternalId
            : null,
        startAt,
        endAt,
        createdByUserId: ctx.state.user?.id ?? null,
        force: force === true,
      });

      if (result.conflicts.length > 0) {
        return jsonResponse(409, {
          error: "Time window conflicts with existing reservation(s)",
          conflicts: result.conflicts,
        });
      }

      return jsonResponse(201, {
        reservation: toReservationRowDTO(result.reservation),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        "ReservationsAPI",
        "Failed to create reservation",
        error as Error,
      );
      return jsonResponse(500, {
        error: "Failed to create reservation",
        detail: message,
      });
    }
  },
});
