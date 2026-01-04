import { z } from "zod";

/**
 * Zod schema for StEvE Transaction
 */
export const StEvETransactionSchema = z.object({
  /** Internal transaction ID */
  id: z.number(),

  /** Charge box identifier */
  chargeBoxId: z.string(),

  /** Internal charge box primary key */
  chargeBoxPk: z.number(),

  /** Connector number on the charge box */
  connectorId: z.number(),

  /** OCPP ID tag used for authorization */
  ocppIdTag: z.string(),

  /** Internal OCPP tag primary key */
  ocppTagPk: z.number(),

  /** ISO timestamp when charging started */
  startTimestamp: z.string(),

  /** Meter value at start (Wh as string) */
  startValue: z.string(),

  /** ISO timestamp when charging stopped (null if still active) */
  stopTimestamp: z.string().nullable(),

  /** Meter value at stop (Wh as string, null if still active) */
  stopValue: z.string().nullable(),

  /** Who/what stopped the transaction */
  stopEventActor: z.string().nullable(),

  /** Reason for stopping */
  stopReason: z.string().nullable(),
});

export type StEvETransaction = z.infer<typeof StEvETransactionSchema>;

/**
 * Extended transaction type with latest meter value
 * Used for active transactions during incremental sync
 */
export const StEvETransactionWithMeterSchema = StEvETransactionSchema.extend({
  /** Latest meter value for active transactions (Wh as string) */
  latestMeterValue: z.string(),
});

export type StEvETransactionWithMeter = z.infer<
  typeof StEvETransactionWithMeterSchema
>;

/**
 * Zod schema for StEvE OCPP Tag
 */
export const StEvEOcppTagSchema = z.object({
  /** The OCPP ID tag string (e.g., "USER001") */
  idTag: z.string(),

  /** Internal primary key */
  ocppTagPk: z.number(),

  /** Optional note/description */
  note: z.string().nullable(),

  /** Parent ID tag for grouping */
  parentIdTag: z.string().nullable(),

  /** Expiry date for the tag (ISO 8601 date-time format) */
  expiryDate: z.string().nullable().optional(),

  /** Maximum number of active transactions allowed (-1 = unlimited, 0 = blocked) */
  maxActiveTransactionCount: z.number().nullable().optional(),
});

export type StEvEOcppTag = z.infer<typeof StEvEOcppTagSchema>;

/**
 * Zod schema for StEvE Charge Box
 */
export const StEvEChargeBoxSchema = z.object({
  /** Charge box identifier */
  chargeBoxId: z.string(),

  /** Internal primary key */
  chargeBoxPk: z.number(),
});

export type StEvEChargeBox = z.infer<typeof StEvEChargeBoxSchema>;

/**
 * Query filters for transactions endpoint
 */
export interface TransactionFilters {
  /** Filter by charge box ID */
  chargeBoxId?: string;

  /** Start date for range (ISO format) */
  from?: string;

  /** End date for range (ISO format) */
  to?: string;

  /** Filter by OCPP ID tag */
  ocppIdTag?: string;

  /** Get specific transaction by ID */
  transactionPk?: number;

  /** Predefined time periods */
  periodType?: "ALL" | "FROM_TO" | "LAST_10" | "LAST_30" | "LAST_90" | "TODAY";

  /** Transaction status filter */
  type?: "ACTIVE" | "ALL";
}
