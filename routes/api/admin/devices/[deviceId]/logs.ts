/**
 * GET /api/admin/devices/{deviceId}/logs
 *
 * Phase 3c read API for the device-log pipeline. Returns OTel-shaped
 * log records for a single device, filterable by severity / category /
 * time range, keyset-paginated by `(observed_ts, seq)`.
 *
 * Auth: admin cookie (middleware-enforced — see `routes/_middleware.ts`).
 *
 * Query params:
 *   severity   = comma-list of TRACE|DEBUG|INFO|WARN|ERROR|FATAL
 *   category   = exact match against `device_logs.category`
 *   since      = ISO-8601 timestamp; lower bound on `observed_ts`
 *   until      = ISO-8601 timestamp; upper bound on `observed_ts`
 *   beforeSeq  = pagination cursor (UInt64 as string); rows with seq <
 *                this OR (observed_ts older than the row at this seq)
 *   afterSeq   = pagination cursor; rows with seq > this (live tail
 *                fallback when SSE isn't open)
 *   limit      = default 100, max 500
 *
 * Response shape:
 *   {
 *     "logs": OTelLogRecord[],
 *     "nextBeforeSeq": string | null,
 *     "latestSeq": string | null
 *   }
 *
 * Errors:
 *   400 invalid_query   — bad enum / int / ISO-8601
 *   404 not_found       — deviceId doesn't exist or is soft-deleted
 *   500 internal        — DB failure
 */

import { and, desc, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { deviceLogs, devices } from "../../../../../src/db/schema.ts";
import { SEVERITY_TEXTS } from "../../../../../src/lib/devices/log-schemas.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceLogsGet");

const QuerySchema = z.object({
  severity: z.string().optional(),
  category: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  beforeSeq: z.string().regex(/^\d+$/).optional(),
  afterSeq: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const SeverityList = z.array(z.enum(SEVERITY_TEXTS));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    const deviceId = ctx.params.deviceId as string | undefined;
    if (!deviceId) {
      return jsonResponse(400, { error: "missing_device_id" });
    }

    // Validate query params.
    const url = new URL(ctx.req.url);
    let parsed: z.infer<typeof QuerySchema>;
    try {
      parsed = QuerySchema.parse(Object.fromEntries(url.searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return jsonResponse(400, {
          error: "invalid_query",
          issues: err.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        });
      }
      return jsonResponse(400, { error: "invalid_query" });
    }

    // Validate severity list separately so the comma-split has a clear
    // failure mode.
    let severities: readonly string[] | null = null;
    if (parsed.severity) {
      const parts = parsed.severity.split(",").map((s) => s.trim()).filter(
        (s) => s.length > 0,
      );
      const result = SeverityList.safeParse(parts);
      if (!result.success) {
        return jsonResponse(400, {
          error: "invalid_query",
          issues: [{ path: ["severity"], message: "unknown severity value" }],
        });
      }
      severities = result.data;
    }

    // Verify the device exists and isn't soft-deleted.
    const [deviceRow] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, deviceId), isNull(devices.deletedAt)))
      .limit(1);
    if (!deviceRow) {
      return jsonResponse(404, { error: "not_found" });
    }

    // Build the where clause.
    const filters = [eq(deviceLogs.deviceId, deviceId)];
    if (parsed.category) {
      filters.push(eq(deviceLogs.category, parsed.category));
    }
    if (parsed.since) {
      filters.push(gte(deviceLogs.observedTs, new Date(parsed.since)));
    }
    if (parsed.until) {
      filters.push(lte(deviceLogs.observedTs, new Date(parsed.until)));
    }
    if (severities) {
      // `severity_text IN (...)` — drizzle's `inArray` is friendlier
      // here than a raw fragment.
      filters.push(
        sql`${deviceLogs.severityText} = ANY(${severities}::text[])`,
      );
    }
    if (parsed.beforeSeq) {
      filters.push(
        sql`${deviceLogs.seq} < ${parsed.beforeSeq}::numeric(20,0)`,
      );
    }
    if (parsed.afterSeq) {
      filters.push(
        sql`${deviceLogs.seq} > ${parsed.afterSeq}::numeric(20,0)`,
      );
    }

    try {
      const rows = await db
        .select()
        .from(deviceLogs)
        .where(and(...filters))
        .orderBy(desc(deviceLogs.observedTs), desc(deviceLogs.seq))
        .limit(parsed.limit);

      const records = rows.map((r) => {
        // Reconstruct the on-the-wire OTel shape from the
        // denormalised columns. The table stores `category` as a
        // separate column for the index but it lives back in
        // `attributes` per the OTel spec.
        const attributes = (r.attributes ?? {}) as Record<string, unknown>;
        if (r.category && attributes.category !== r.category) {
          attributes.category = r.category;
        }
        return {
          timestamp: r.timestampNs.toString(),
          observed_timestamp: (BigInt(r.observedTs.getTime()) * 1_000_000n)
            .toString(),
          severity_text: r.severityText,
          severity_number: r.severityNumber,
          body: r.body,
          attributes,
          resource: r.resource,
          trace_id: r.traceId,
          span_id: r.spanId,
        };
      });

      // Pagination cursors. `nextBeforeSeq` is the seq of the LAST row
      // we returned — passing it back via `beforeSeq` paginates older.
      // `latestSeq` is the highest seq we have for this device (useful
      // for the live-tail fallback to know where to start polling).
      const nextBeforeSeq = rows.length > 0
        ? rows[rows.length - 1].seq.toString()
        : null;

      const [latestRow] = await db
        .select({ seq: deviceLogs.seq })
        .from(deviceLogs)
        .where(eq(deviceLogs.deviceId, deviceId))
        .orderBy(desc(deviceLogs.seq))
        .limit(1);
      const latestSeq = latestRow?.seq.toString() ?? null;

      return jsonResponse(200, {
        logs: records,
        nextBeforeSeq,
        latestSeq,
      });
    } catch (err) {
      log.error("device_logs query failed", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
  },
});

// Quiet linter — these imports are used inside the SQL fragment chain
// above but TS's reachability analysis sometimes misses them.
void gt;
void lt;
