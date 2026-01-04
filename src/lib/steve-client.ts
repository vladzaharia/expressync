import { config } from "./config.ts";
import {
  type StEvEChargeBox,
  StEvEChargeBoxSchema,
  type StEvEOcppTag,
  StEvEOcppTagSchema,
  type StEvETransaction,
  StEvETransactionSchema,
  type StEvETransactionWithMeter,
  StEvETransactionWithMeterSchema,
  type TransactionFilters,
} from "./types/steve.ts";
import { z } from "zod";
import { retry } from "./utils/retry.ts";
import { logger } from "./utils/logger.ts";

/**
 * Client for interacting with StEvE OCPP Management System REST API
 */
class StEvEClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.STEVE_API_URL;
    this.apiKey = config.STEVE_API_KEY;
  }

  /**
   * Make an authenticated request to StEvE API with retry logic
   */
  private async request<T>(
    path: string,
    schema: z.ZodSchema<T>,
    options: RequestInit = {},
  ): Promise<T> {
    return retry(async () => {
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

      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
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
        dataSize: Array.isArray(data) ? data.length : Object.keys(data).length,
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
   * Fetch all OCPP ID tags
   */
  async getOcppTags(): Promise<StEvEOcppTag[]> {
    return this.request("/v1/ocppTags", z.array(StEvEOcppTagSchema));
  }

  /**
   * Alias for getOcppTags (consistent naming)
   */
  async getOcppIdTags(): Promise<StEvEOcppTag[]> {
    return this.getOcppTags();
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
   * Fetch all charge boxes
   */
  async getChargeBoxes(): Promise<StEvEChargeBox[]> {
    return this.request("/v1/chargeBoxes", z.array(StEvEChargeBoxSchema));
  }

  /**
   * Get all currently active (in-progress) transactions
   *
   * Used for incremental billing during charging sessions.
   * Returns transactions that have started but not yet stopped.
   */
  async getActiveTransactions(): Promise<StEvETransactionWithMeter[]> {
    logger.info("StEvE", "Fetching active transactions");

    const transactions = await this.getTransactions({ type: "ACTIVE" });

    logger.debug("StEvE", "Active transactions retrieved", {
      count: transactions.length,
      transactionIds: transactions.map((tx) => tx.id),
    });

    // For active transactions, we need to get the latest meter value
    // StEvE may include this in the response, or we may need to fetch separately
    const withMeter = transactions.map((tx) => ({
      ...tx,
      // latestMeterValue comes from StEvE's meter values endpoint or
      // is included in the transaction response
      latestMeterValue: (tx as any).latestMeterValue || tx.startValue,
    }));

    logger.debug("StEvE", "Meter values assigned", {
      count: withMeter.length,
    });

    return withMeter;
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
}

// Export singleton instance
export const steveClient = new StEvEClient();
