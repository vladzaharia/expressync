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

  /** Whether this tag is blocked */
  blocked: z.boolean().optional(),

  /** Whether this tag is currently in a transaction */
  inTransaction: z.boolean().optional(),

  /** Number of currently active transactions */
  activeTransactionCount: z.number().optional(),

  /** Parent OCPP tag primary key */
  parentOcppTagPk: z.number().nullable().optional(),
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

// ============================================================================
// === Phase B: OCPP tag filters + charger form factors ===
// ============================================================================

/**
 * Query filters for the /v1/ocppTags endpoint.
 *
 * All filters are optional; calling `getOcppTags()` with no args preserves
 * the original no-filter behavior. `ALL` is StEvE's explicit "don't filter"
 * sentinel for the tri-state boolean params.
 */
export interface OcppTagFilters {
  blocked?: "ALL" | "TRUE" | "FALSE";
  expired?: "ALL" | "TRUE" | "FALSE";
  inTransaction?: "ALL" | "TRUE" | "FALSE";
  idTag?: string;
  ocppTagPk?: number;
  parentIdTag?: string;
}

/**
 * Charger form factors - drives the SVG icon shown in the charger card grid
 * (Phase J). Single source of truth consumed by UI + server + DB CHECK
 * constraint.
 */
export const FORM_FACTORS = [
  "wallbox",
  "pulsar",
  "commander",
  "wall_mount",
  "generic",
] as const;
export type FormFactor = typeof FORM_FACTORS[number];

// ============================================================================
// === Phase A: OCPP operations (non-destructive subset) ===
// ============================================================================

/**
 * Canonical list of allowed OCPP operation names.
 *
 * These names match the StEvE REST path suffix under `/v1/operations/{name}`
 * (see `OcppOperationsController.java`). This is the single source of truth
 * consumed by BOTH the server-side allowlist in `routes/api/charger/operation.ts`
 * and any UI that hides destructive ops.
 *
 * Explicitly excluded (use StEvE admin UI):
 *   Reset, ClearCache, UpdateFirmware, SendLocalList, ClearChargingProfile,
 *   ChangeConfiguration.
 */
export const ALLOWED_OPERATIONS = [
  "RemoteStartTransaction",
  "RemoteStopTransaction",
  "UnlockConnector",
  "ReserveNow",
  "CancelReservation",
  "TriggerMessage",
  "GetConfiguration",
  "GetCompositeSchedule",
  "GetDiagnostics",
  "GetLocalListVersion",
  "DataTransfer",
  "SetChargingProfile",
  "ChangeAvailability",
] as const;

export type OcppOperationName = typeof ALLOWED_OPERATIONS[number];

/**
 * Fast membership predicate. Keep the allowlist sanity check in one place so
 * UI and server use identical logic.
 */
export function isAllowedOperation(op: string): op is OcppOperationName {
  return (ALLOWED_OPERATIONS as readonly string[]).includes(op);
}

// --- Shared selection shapes -------------------------------------------------

/**
 * Selection wrapper for operations that target exactly 1 charge point.
 * StEvE expects `chargeBoxIdList: [chargeBoxId]` on the wire (see
 * `SingleChargePointSelect.java`). We accept a friendlier `chargeBoxId` on our
 * route and adapt on the client side.
 */
const SingleChargeBoxSelectionSchema = z.object({
  chargeBoxId: z.string().min(1),
});

/**
 * Selection wrapper for operations that accept >= 1 charge point.
 * Accepts either a single `chargeBoxId` or a `chargeBoxIdList`.
 */
const MultipleChargeBoxSelectionSchema = z.object({
  chargeBoxId: z.string().min(1).optional(),
  chargeBoxIdList: z.array(z.string().min(1)).min(1).optional(),
}).refine(
  (v) => Boolean(v.chargeBoxId) || (v.chargeBoxIdList?.length ?? 0) > 0,
  { message: "Either chargeBoxId or chargeBoxIdList is required" },
);

// --- Per-op request schemas --------------------------------------------------

/** `POST /v1/operations/RemoteStartTransaction` */
export const RemoteStartTransactionParamsSchema = SingleChargeBoxSelectionSchema
  .extend({
    /** Connector number (>= 0). 0 means charge point as a whole. */
    connectorId: z.number().int().min(0).optional(),
    /** OCPP ID tag (required). */
    idTag: z.string().min(1),
    /** Optional TX_PROFILE charging profile PK. */
    chargingProfilePk: z.number().int().positive().optional(),
  });
export type RemoteStartTransactionParams = z.infer<
  typeof RemoteStartTransactionParamsSchema
>;

/** `POST /v1/operations/RemoteStopTransaction` */
export const RemoteStopTransactionParamsSchema = SingleChargeBoxSelectionSchema
  .extend({
    transactionId: z.number().int(),
  });
export type RemoteStopTransactionParams = z.infer<
  typeof RemoteStopTransactionParamsSchema
>;

/** `POST /v1/operations/UnlockConnector` */
export const UnlockConnectorParamsSchema = SingleChargeBoxSelectionSchema
  .extend({
    connectorId: z.number().int().min(1),
  });
export type UnlockConnectorParams = z.infer<
  typeof UnlockConnectorParamsSchema
>;

/** `POST /v1/operations/ReserveNow` */
export const ReserveNowParamsSchema = SingleChargeBoxSelectionSchema.extend({
  connectorId: z.number().int().min(0),
  /** ISO-8601 datetime string; StEvE requires future. */
  expiry: z.string().min(1),
  idTag: z.string().min(1),
});
export type ReserveNowParams = z.infer<typeof ReserveNowParamsSchema>;

/** `POST /v1/operations/CancelReservation` */
export const CancelReservationParamsSchema = SingleChargeBoxSelectionSchema
  .extend({
    reservationId: z.number().int().min(0),
  });
export type CancelReservationParams = z.infer<
  typeof CancelReservationParamsSchema
>;

/** Subset of OCPP 1.6 TriggerMessageRequestedMessage enum supported by StEvE. */
export const TriggerMessageEnum = z.enum([
  "BootNotification",
  "DiagnosticsStatusNotification",
  "FirmwareStatusNotification",
  "Heartbeat",
  "MeterValues",
  "StatusNotification",
]);
export type TriggerMessageRequestedMessage = z.infer<typeof TriggerMessageEnum>;

/** `POST /v1/operations/TriggerMessage` */
export const TriggerMessageParamsSchema = MultipleChargeBoxSelectionSchema.and(
  z.object({
    triggerMessage: TriggerMessageEnum,
    connectorId: z.number().int().min(1).optional(),
  }),
);
export type TriggerMessageParams = z.infer<typeof TriggerMessageParamsSchema>;

/** `POST /v1/operations/GetConfiguration` */
export const GetConfigurationParamsSchema = MultipleChargeBoxSelectionSchema
  .and(
    z.object({
      /** List of Configuration Keys predefined by OCPP. */
      confKeyList: z.array(z.string()).optional(),
      /** Comma-separated custom keys. */
      commaSeparatedCustomConfKeys: z.string().optional(),
    }),
  );
export type GetConfigurationParams = z.infer<
  typeof GetConfigurationParamsSchema
>;

/** Charging rate unit enum. */
export const ChargingRateUnitEnum = z.enum(["A", "W"]);

/** `POST /v1/operations/GetCompositeSchedule` */
export const GetCompositeScheduleParamsSchema = MultipleChargeBoxSelectionSchema
  .and(
    z.object({
      connectorId: z.number().int().min(0),
      durationInSeconds: z.number().int().positive(),
      chargingRateUnit: ChargingRateUnitEnum.optional(),
    }),
  );
export type GetCompositeScheduleParams = z.infer<
  typeof GetCompositeScheduleParamsSchema
>;

/** `POST /v1/operations/GetDiagnostics` */
export const GetDiagnosticsParamsSchema = MultipleChargeBoxSelectionSchema.and(
  z.object({
    /** Upload URL (e.g. ftp://user:pass@example.com/logs/). */
    location: z.string().min(1).regex(/\S+/),
    retries: z.number().int().min(1).optional(),
    retryInterval: z.number().int().min(1).optional(),
    /** ISO-8601 — must be in the past per StEvE. */
    start: z.string().optional(),
    /** ISO-8601 — must be in the past per StEvE. */
    stop: z.string().optional(),
  }),
);
export type GetDiagnosticsParams = z.infer<typeof GetDiagnosticsParamsSchema>;

/** `POST /v1/operations/GetLocalListVersion` — MultipleChargePointSelect only. */
export const GetLocalListVersionParamsSchema = MultipleChargeBoxSelectionSchema;
export type GetLocalListVersionParams = z.infer<
  typeof GetLocalListVersionParamsSchema
>;

/** `POST /v1/operations/DataTransfer` */
export const DataTransferParamsSchema = MultipleChargeBoxSelectionSchema.and(
  z.object({
    vendorId: z.string().min(1),
    messageId: z.string().optional(),
    data: z.string().optional(),
  }),
);
export type DataTransferParams = z.infer<typeof DataTransferParamsSchema>;

/** `POST /v1/operations/SetChargingProfile` */
export const SetChargingProfileParamsSchema = MultipleChargeBoxSelectionSchema
  .and(
    z.object({
      connectorId: z.number().int().min(0),
      chargingProfilePk: z.number().int().positive(),
      transactionId: z.number().int().positive().optional(),
    }),
  );
export type SetChargingProfileParams = z.infer<
  typeof SetChargingProfileParamsSchema
>;

/** OCPP 1.6 AvailabilityType. */
export const AvailabilityTypeEnum = z.enum(["Inoperative", "Operative"]);

/** `POST /v1/operations/ChangeAvailability` */
export const ChangeAvailabilityParamsSchema = MultipleChargeBoxSelectionSchema
  .and(
    z.object({
      /** 0 (default) = charge point as a whole. */
      connectorId: z.number().int().min(0).optional(),
      availType: AvailabilityTypeEnum,
    }),
  );
export type ChangeAvailabilityParams = z.infer<
  typeof ChangeAvailabilityParamsSchema
>;

/**
 * Map of operation name → request param schema. Used by the server route to
 * validate params in a type-safe way before forwarding to the client. Keep in
 * lock-step with `ALLOWED_OPERATIONS`.
 */
export const OPERATION_PARAM_SCHEMAS: Record<
  OcppOperationName,
  z.ZodType<unknown>
> = {
  RemoteStartTransaction: RemoteStartTransactionParamsSchema,
  RemoteStopTransaction: RemoteStopTransactionParamsSchema,
  UnlockConnector: UnlockConnectorParamsSchema,
  ReserveNow: ReserveNowParamsSchema,
  CancelReservation: CancelReservationParamsSchema,
  TriggerMessage: TriggerMessageParamsSchema,
  GetConfiguration: GetConfigurationParamsSchema,
  GetCompositeSchedule: GetCompositeScheduleParamsSchema,
  GetDiagnostics: GetDiagnosticsParamsSchema,
  GetLocalListVersion: GetLocalListVersionParamsSchema,
  DataTransfer: DataTransferParamsSchema,
  SetChargingProfile: SetChargingProfileParamsSchema,
  ChangeAvailability: ChangeAvailabilityParamsSchema,
};

// --- Response schemas -------------------------------------------------------

/**
 * StEvE's `OcppOperationResponse<T>` always carries a synchronous `taskId`.
 * On 3.12.0 the full OCPP round-trip happens async and success/error arrays
 * may never be populated on this same response — polling for the task is
 * best-effort (see `operations.getTask`).
 *
 * We accept both numeric and string `taskId` in case StEvE stringifies ints.
 */
export const OcppTaskResultSchema = z.object({
  taskId: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === "string" ? parseInt(v, 10) : v
  ),
  taskFinished: z.boolean().optional(),
  successResponses: z
    .array(
      z.object({
        chargeBoxId: z.string(),
        response: z.unknown(),
      }),
    )
    .optional(),
  errorResponses: z
    .array(
      z.object({
        chargeBoxId: z.string(),
        errorCode: z.string().nullable().optional(),
        errorDescription: z.string().nullable().optional(),
        errorDetails: z.string().nullable().optional(),
      }),
    )
    .optional(),
  exceptions: z
    .array(
      z.object({
        chargeBoxId: z.string(),
        exceptionMessage: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
export type OcppTaskResult = z.infer<typeof OcppTaskResultSchema>;

/**
 * Schema returned from the best-effort task polling endpoint. StEvE 3.12.0
 * may not expose this at all — we map 404 to `null` at the client layer and
 * surface the raw shape when the endpoint is available on master builds.
 */
export const OcppTaskStatusSchema = z.object({
  taskId: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === "string" ? parseInt(v, 10) : v
  ),
  taskFinished: z.boolean().optional(),
  successResponses: z.array(z.unknown()).optional(),
  errorResponses: z.array(z.unknown()).optional(),
  exceptions: z.array(z.unknown()).optional(),
}).passthrough();
export type OcppTaskStatus = z.infer<typeof OcppTaskStatusSchema>;
