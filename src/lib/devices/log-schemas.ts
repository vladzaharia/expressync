/**
 * Zod schemas for the OpenTelemetry-shaped log records ingested via
 * the device-state sync envelope. The wire format is documented in
 * `docs/logging/contract.md` and mirrored on the iOS side at
 * `Sources/DeviceLogging/OTelLogRecord.swift`.
 *
 * Phase 3c — see `~/.claude/plans/i-m-having-trouble-loading-sleepy-crescent.md`.
 */

import { z } from "zod";

/** Severity buckets the table indexes on. Kept in lockstep with the
 *  iOS `OTelSeverity.text(for:)` map. */
export const SEVERITY_TEXTS = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
] as const;

/** OTel attribute values are heterogeneous JSON. Zod can't recursively
 *  type itself without `z.lazy`; we approximate with `z.unknown()` and
 *  rely on size + count caps to defend against runaway nesting. */
const attributeValueSchema = z.unknown();

/** The full OTel `LogRecord` shape. Top-level fields are pinned; the
 *  `attributes` and `resource` blobs are open-ended. */
export const otelLogRecordSchema = z.object({
  timestamp: z.union([z.number().int(), z.string().regex(/^\d+$/)])
    .describe("nanoseconds since epoch (number or string-encoded BigInt)"),
  observed_timestamp: z.union([
    z.number().int(),
    z.string().regex(/^\d+$/),
  ]).optional(),
  severity_text: z.enum(SEVERITY_TEXTS),
  severity_number: z.number().int().min(1).max(24),
  body: z.string().max(4 * 1024),
  attributes: z.record(z.string(), attributeValueSchema).default({}),
  resource: z.record(z.string(), attributeValueSchema).default({}),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/).nullable().optional(),
  span_id: z.string().regex(/^[0-9a-f]{16}$/).nullable().optional(),
}).strict();

/** Cap per sync request — paired with the iOS-side ring-buffer drain
 *  cap (also 100). Bigger backlogs flush across multiple syncs. */
export const MAX_LOGS_PER_SYNC = 100;

/** Cap per record. Records exceeding this are rejected at zod parse;
 *  on the wire we expect ~250 KB total / 100 records = ~2.5 KB each
 *  on average, so 4 KiB per record body is a comfortable ceiling. */
export const MAX_LOG_BODY_BYTES = 4 * 1024;

/** Helper: pull `expressync.seq` out of `attributes` as a `bigint`.
 *  Returns `null` when missing or unparseable — caller should drop
 *  records without a seq (they couldn't be deduped anyway). */
export function extractSeq(record: z.infer<typeof otelLogRecordSchema>):
  | bigint
  | null {
  const seqAttr = record.attributes?.["expressync.seq"];
  if (typeof seqAttr === "string") {
    try {
      return BigInt(seqAttr);
    } catch {
      return null;
    }
  }
  if (typeof seqAttr === "number" && Number.isFinite(seqAttr)) {
    return BigInt(Math.trunc(seqAttr));
  }
  return null;
}

/** Helper: pull `category` out of `attributes` as a string for the
 *  denormalised `device_logs.category` column. */
export function extractCategory(record: z.infer<typeof otelLogRecordSchema>):
  | string
  | null {
  const cat = record.attributes?.["category"];
  return typeof cat === "string" ? cat : null;
}

/** Server-side timestamp clamping (nanoseconds). Defends against
 *  clock-skewed clients writing into the future. Mirrors
 *  `clampClientUpdatedAt` for ms-resolution settings. */
export function clampLogTimestampNs(
  rawNs: number | string,
  nowMs: number,
): bigint {
  const ns = typeof rawNs === "string" ? BigInt(rawNs) : BigInt(rawNs);
  const ceilingNs = BigInt(nowMs) * 1_000_000n + 5_000_000_000n; // now + 5s
  return ns > ceilingNs ? ceilingNs : ns;
}

export type OTelLogRecord = z.infer<typeof otelLogRecordSchema>;
