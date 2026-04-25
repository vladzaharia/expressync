import { config } from "./config.ts";
import {
  type CancelReservationParams,
  type ChangeAvailabilityParams,
  type ChangeConfigurationParams,
  type DataTransferParams,
  type GetCompositeScheduleParams,
  type GetConfigurationParams,
  type GetDiagnosticsParams,
  type GetLocalListVersionParams,
  type OcppOperationName,
  type OcppTagFilters,
  type OcppTaskResult,
  OcppTaskResultSchema,
  type OcppTaskStatus,
  OcppTaskStatusSchema,
  type RemoteStartTransactionParams,
  type RemoteStopTransactionParams,
  type ReserveNowParams,
  type SetChargingProfileParams,
  type StEvEChargeBox,
  type StEvEOcppTag,
  StEvEOcppTagSchema,
  type StEvETransaction,
  StEvETransactionSchema,
  type TransactionFilters,
  type TriggerMessageParams,
  type UnlockConnectorParams,
} from "./types/steve.ts";
import { z } from "zod";
import { retry } from "./utils/retry.ts";
import { logger } from "./utils/logger.ts";

/**
 * Client for interacting with StEvE OCPP Management System REST API
 */
class StEvEClient {
  private baseUrl: string;
  private authHeader: string;

  constructor() {
    this.baseUrl = config.STEVE_API_URL;
    // SteVe 3.8+ REST API uses HTTP Basic auth.
    // Username = auth.user; password = webapi.value (seeded into web_user.api_password).
    this.authHeader = "Basic " +
      btoa(`${config.STEVE_API_USERNAME}:${config.STEVE_API_KEY}`);
  }

  /**
   * Make an authenticated request to StEvE API with retry logic
   */
  private async request<T>(
    path: string,
    schema: z.ZodSchema<T>,
    options: RequestInit = {},
  ): Promise<T> {
    return await retry(async () => {
      const url = `${this.baseUrl}${path}`;
      const method = options.method || "GET";

      logger.info("StEvE", `${method} ${path}`, { url });

      // Log request body for debugging
      if (options.body) {
        try {
          const bodyData = JSON.parse(options.body as string);
          logger.debug("StEvE", "Request body", bodyData);
        } catch {
          logger.debug("StEvE", "Request body (raw)", { body: options.body });
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": this.authHeader,
            ...options.headers,
          },
        });

        logger.debug("StEvE", "Response received", {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("StEvE", "API request failed", {
            method,
            path,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          });
          throw new Error(
            `StEvE API error: ${response.status} ${response.statusText} - ${errorText}`,
          );
        }

        const data = await response.json();
        logger.debug("StEvE", "Response data received", {
          dataType: Array.isArray(data) ? "array" : typeof data,
          dataSize: Array.isArray(data)
            ? data.length
            : Object.keys(data).length,
        });

        // Validate response with Zod schema
        try {
          const validated = schema.parse(data);
          logger.debug("StEvE", "Response validation successful");
          return validated;
        } catch (error) {
          logger.error("StEvE", "Response validation failed", {
            error: error instanceof Error ? error.message : String(error),
            receivedDataSample: Array.isArray(data) ? data.slice(0, 2) : data,
          });
          throw new Error(`StEvE API response validation failed: ${error}`);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }, {
      maxAttempts: 3,
      initialDelay: 1000,
      logAttempts: true,
    });
  }

  /**
   * Fetch transactions with optional filters
   */
  async getTransactions(
    filters: TransactionFilters = {},
  ): Promise<StEvETransaction[]> {
    const params = new URLSearchParams();

    if (filters.chargeBoxId) params.set("chargeBoxId", filters.chargeBoxId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.ocppIdTag) params.set("ocppIdTag", filters.ocppIdTag);
    if (filters.transactionPk) {
      params.set("transactionPk", filters.transactionPk.toString());
    }
    if (filters.periodType) params.set("periodType", filters.periodType);
    if (filters.type) params.set("type", filters.type);

    const queryString = params.toString();
    const path = `/v1/transactions${queryString ? `?${queryString}` : ""}`;

    logger.info("StEvE", "Fetching transactions", { filters, queryString });

    const transactions = await this.request(
      path,
      z.array(StEvETransactionSchema),
    );

    logger.debug("StEvE", "Transactions fetched", {
      count: transactions.length,
      filters,
    });

    return transactions;
  }

  /**
   * Fetch OCPP ID tags, optionally filtered.
   *
   * Phase B: StEvE's `/v1/ocppTags` supports query filters documented in the
   * OpenAPI spec:
   * - `blocked`, `expired`, `inTransaction` — tri-state: "ALL" | "TRUE" | "FALSE"
   * - `idTag`, `parentIdTag` — string match
   * - `ocppTagPk` — numeric PK
   *
   * Called with no args, it preserves the original "list all tags" behavior.
   * `{ inTransaction: "TRUE" }` is the cheap "is anyone charging right now"
   * signal for the adaptive scheduler (Phase C).
   */
  async getOcppTags(filters?: OcppTagFilters): Promise<StEvEOcppTag[]> {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.blocked !== undefined) params.set("blocked", filters.blocked);
      if (filters.expired !== undefined) params.set("expired", filters.expired);
      if (filters.inTransaction !== undefined) {
        params.set("inTransaction", filters.inTransaction);
      }
      if (filters.idTag !== undefined) params.set("idTag", filters.idTag);
      if (filters.ocppTagPk !== undefined) {
        params.set("ocppTagPk", filters.ocppTagPk.toString());
      }
      if (filters.parentIdTag !== undefined) {
        params.set("parentIdTag", filters.parentIdTag);
      }
    }

    const queryString = params.toString();
    const path = `/v1/ocppTags${queryString ? `?${queryString}` : ""}`;

    return await this.request(path, z.array(StEvEOcppTagSchema));
  }

  /**
   * Create a new OCPP tag
   *
   * @param idTag - The OCPP ID tag string (unique identifier)
   * @param options - Optional fields for the tag
   * @returns The created tag's primary key
   */
  async createOcppTag(
    idTag: string,
    options: {
      note?: string;
      parentIdTag?: string;
      maxActiveTransactionCount?: number;
      expiryDate?: string;
    } = {},
  ): Promise<{ ocppTagPk: number }> {
    logger.info("StEvE", "Creating OCPP tag", { idTag, options });

    const formData: Record<string, unknown> = {
      idTag,
      maxActiveTransactionCount: options.maxActiveTransactionCount ?? 1,
    };

    if (options.note) formData.note = options.note;
    if (options.parentIdTag) formData.parentIdTag = options.parentIdTag;
    if (options.expiryDate) formData.expiryDate = options.expiryDate;

    logger.debug("StEvE", "Sending tag create request", { formData });

    const result = await this.request(
      "/v1/ocppTags",
      z.object({ ocppTagPk: z.number() }),
      {
        method: "POST",
        body: JSON.stringify(formData),
      },
    );

    logger.info("StEvE", "OCPP tag created successfully", {
      idTag,
      ocppTagPk: result.ocppTagPk,
    });

    return result;
  }

  /**
   * Update an OCPP tag
   *
   * StEvE's PUT endpoint requires the complete tag object (OcppTagForm),
   * not just the fields being updated. We must send all fields.
   *
   * @param tag - The complete tag object with updates applied
   */
  async updateOcppTag(tag: StEvEOcppTag): Promise<void> {
    logger.info("StEvE", "Updating OCPP tag", {
      ocppTagPk: tag.ocppTagPk,
      idTag: tag.idTag,
      maxActiveTransactionCount: tag.maxActiveTransactionCount,
    });

    // Build the complete OcppTagForm object
    // All fields are optional, but we send all available data
    const formData: Record<string, unknown> = {
      idTag: tag.idTag, // Required for identification (though ignored in updates per spec)
      maxActiveTransactionCount: tag.maxActiveTransactionCount,
    };

    // Add optional fields if they exist
    if (tag.note !== undefined && tag.note !== null) {
      formData.note = tag.note;
    }
    if (tag.parentIdTag !== undefined && tag.parentIdTag !== null) {
      formData.parentIdTag = tag.parentIdTag;
    }
    if (tag.expiryDate !== undefined && tag.expiryDate !== null) {
      formData.expiryDate = tag.expiryDate;
    }

    logger.debug("StEvE", "Sending tag update request", {
      ocppTagPk: tag.ocppTagPk,
      formData,
    });

    await this.request(
      `/v1/ocppTags/${tag.ocppTagPk}`,
      z.object({}), // StEvE typically returns empty object on success
      {
        method: "PUT",
        body: JSON.stringify(formData),
      },
    );

    logger.debug("StEvE", "OCPP tag updated successfully", {
      ocppTagPk: tag.ocppTagPk,
    });
  }

  /**
   * Fetch all charge boxes.
   *
   * SteVe 3.12.0 has no REST endpoint for listing charge boxes — only
   * /v1/ocppTags, /v1/transactions, and /v1/operations/* exist. Derive the
   * list from the transactions endpoint instead (distinct chargeBoxId/Pk),
   * so charge boxes that have never been involved in a transaction will not
   * appear. This is a known limitation until upstream adds a listing endpoint.
   *
   * Phase B: callers that need a stable charger roster should read from
   * `chargers_cache` via `src/services/charger-cache.service.ts` instead of
   * calling this on every request. The cache is refreshed at the end of
   * every sync run and records `first_seen_at` / `last_seen_at` so stale
   * chargers stay visible with an "Offline" badge rather than disappearing.
   */
  async getChargeBoxes(): Promise<StEvEChargeBox[]> {
    const transactions = await this.request(
      "/v1/transactions?type=ALL&periodType=ALL",
      z.array(StEvETransactionSchema),
    );
    const seen = new Map<number, StEvEChargeBox>();
    for (const tx of transactions) {
      if (!seen.has(tx.chargeBoxPk)) {
        seen.set(tx.chargeBoxPk, {
          chargeBoxId: tx.chargeBoxId,
          chargeBoxPk: tx.chargeBoxPk,
        });
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Format date for StEvE API (ISO8601 without timezone)
   * StEvE expects: 2022-10-10T09:00:00 (no Z, no milliseconds)
   */
  private formatDateForStEvE(date: Date): string {
    return date.toISOString().split(".")[0]; // Remove milliseconds and Z
  }

  /**
   * Get recently completed transactions (for catching ones we may have missed)
   *
   * @param minutesAgo - How far back to look (default 24 hours)
   */
  async getRecentlyCompletedTransactions(
    minutesAgo: number = 1440,
  ): Promise<StEvETransaction[]> {
    const fromDate = new Date(Date.now() - minutesAgo * 60 * 1000);
    const toDate = new Date();

    logger.info("StEvE", "Fetching recently completed transactions", {
      minutesAgo,
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
    });

    const transactions = await this.getTransactions({
      type: "ALL",
      periodType: "FROM_TO",
      from: this.formatDateForStEvE(fromDate),
      to: this.formatDateForStEvE(toDate),
    });

    // Filter to only completed ones
    const completed = transactions.filter((tx) => tx.stopTimestamp !== null);

    logger.debug("StEvE", "Completed transactions filtered", {
      totalFetched: transactions.length,
      completedCount: completed.length,
      completedIds: completed.map((tx) => tx.id),
    });

    return completed;
  }

  // ==========================================================================
  // === Phase A: OCPP operations (non-destructive subset) ===
  // ==========================================================================

  /**
   * Normalize a selection object to the shape StEvE expects on the wire:
   * `chargeBoxIdList: [...]`. Accepts either `chargeBoxId` (single-select
   * operations) or `chargeBoxIdList` (multi-select) and always returns an
   * object without the friendlier `chargeBoxId` key so StEvE validates it.
   */
  private normalizeSelection<
    T extends { chargeBoxId?: string; chargeBoxIdList?: string[] },
  >(body: T): Omit<T, "chargeBoxId"> & { chargeBoxIdList: string[] } {
    const { chargeBoxId, chargeBoxIdList, ...rest } = body;
    const list = chargeBoxIdList && chargeBoxIdList.length > 0
      ? chargeBoxIdList
      : (chargeBoxId ? [chargeBoxId] : []);
    return { ...rest, chargeBoxIdList: list } as
      & Omit<T, "chargeBoxId">
      & { chargeBoxIdList: string[] };
  }

  /**
   * Thin POST helper reusing the class-wide `request()` pipeline (retry,
   * Zod, logger, auth). All allowed OCPP operations go through this method
   * so behavior stays consistent and the retry budget is honored.
   */
  private postOperation<TReq extends Record<string, unknown>, TRes>(
    opName: OcppOperationName,
    body: TReq,
    resSchema: z.ZodSchema<TRes>,
  ): Promise<TRes> {
    const normalized = this.normalizeSelection(
      body as { chargeBoxId?: string; chargeBoxIdList?: string[] } & TReq,
    );
    logger.info("StEvE", `Invoking OCPP operation ${opName}`, {
      chargeBoxIdList: normalized.chargeBoxIdList,
    });
    return this.request(`/v1/operations/${opName}`, resSchema, {
      method: "POST",
      body: JSON.stringify(normalized),
    });
  }

  /**
   * Namespaced OCPP operations. Destructive ops (Reset, ClearCache,
   * UpdateFirmware, SendLocalList, ClearChargingProfile, ChangeConfiguration)
   * are deliberately absent — use the StEvE admin UI.
   */
  readonly operations = {
    remoteStart: (
      params: RemoteStartTransactionParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "RemoteStartTransaction",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    remoteStop: (
      params: RemoteStopTransactionParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "RemoteStopTransaction",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    unlockConnector: (params: UnlockConnectorParams): Promise<OcppTaskResult> =>
      this.postOperation(
        "UnlockConnector",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    reserveNow: (params: ReserveNowParams): Promise<OcppTaskResult> =>
      this.postOperation(
        "ReserveNow",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    cancelReservation: (
      params: CancelReservationParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "CancelReservation",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    triggerMessage: (params: TriggerMessageParams): Promise<OcppTaskResult> =>
      this.postOperation(
        "TriggerMessage",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    getConfiguration: (
      params: GetConfigurationParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "GetConfiguration",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    getCompositeSchedule: (
      params: GetCompositeScheduleParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "GetCompositeSchedule",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    getDiagnostics: (params: GetDiagnosticsParams): Promise<OcppTaskResult> =>
      this.postOperation(
        "GetDiagnostics",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    getLocalListVersion: (
      params: GetLocalListVersionParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "GetLocalListVersion",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    dataTransfer: (params: DataTransferParams): Promise<OcppTaskResult> =>
      this.postOperation(
        "DataTransfer",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    setChargingProfile: (
      params: SetChargingProfileParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "SetChargingProfile",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    changeAvailability: (
      params: ChangeAvailabilityParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "ChangeAvailability",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    /**
     * Set a single OCPP ConfigurationKey via SteVe's REST operations
     * endpoint. Used by `scripts/push-charger-preauth-config.ts` to
     * disable local-auth caches as a prerequisite for the pre-auth
     * hook.
     */
    changeConfiguration: (
      params: ChangeConfigurationParams,
    ): Promise<OcppTaskResult> =>
      this.postOperation(
        "ChangeConfiguration",
        params as unknown as Record<string, unknown>,
        OcppTaskResultSchema,
      ),

    /**
     * Best-effort task status polling.
     *
     * StEvE 3.12.0 does not ship the `/v1/operations/{taskId}` endpoint
     * (only master adds a TasksController). Returns `null` on 404 so the
     * caller can surface a "pending" state with a StEvE admin link instead
     * of erroring. Other failures propagate so the retry pipeline can
     * recover from transient network issues.
     */
    getTask: async (taskId: number): Promise<OcppTaskStatus | null> => {
      const url = `${this.baseUrl}/v1/operations/${taskId}`;
      logger.debug("StEvE", "Polling OCPP task", { taskId });
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": this.authHeader,
          },
        });
        if (response.status === 404) {
          logger.debug(
            "StEvE",
            "Task polling endpoint not available (404) — 3.12.0 has no TasksController",
            { taskId },
          );
          // Drain the body so the connection is returned to the pool.
          await response.body?.cancel();
          return null;
        }
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `StEvE task poll failed: ${response.status} ${response.statusText} - ${errorText}`,
          );
        }
        const data = await response.json();
        return OcppTaskStatusSchema.parse(data);
      } catch (error) {
        logger.warn("StEvE", "Task polling errored", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

// Export singleton instance
export const steveClient = new StEvEClient();
