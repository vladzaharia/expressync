import { config } from "./config.ts";
import {
  type LagoCustomer,
  LagoCustomerSchema,
  type LagoCurrentUsage,
  LagoCurrentUsageSchema,
  type LagoEvent,
  LagoEventSchema,
  type LagoSubscription,
  LagoSubscriptionSchema,
} from "./types/lago.ts";
import { z } from "zod";
import { retry } from "./utils/retry.ts";
import { logger } from "./utils/logger.ts";

/**
 * Client for interacting with Lago Billing Platform API
 */
class LagoClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.LAGO_API_URL;
    this.apiKey = config.LAGO_API_KEY;
  }

  /**
   * Make an authenticated request to Lago API with retry logic
   */
  private async request<T>(
    path: string,
    schema: z.ZodSchema<T>,
    options: RequestInit = {}
  ): Promise<T> {
    return retry(async () => {
      const url = `${this.baseUrl}${path}`;
      const method = options.method || "GET";

      logger.info("Lago", `${method} ${path}`, { url });

      // Log request body for debugging
      if (options.body) {
        try {
          const bodyData = JSON.parse(options.body as string);
          logger.debug("Lago", "Request body", bodyData);
        } catch {
          logger.debug("Lago", "Request body (raw)", { body: options.body });
        }
      }

      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          ...options.headers,
        },
      });

      logger.debug("Lago", "Response received", {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Lago", "API request failed", {
          method,
          path,
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText,
        });
        throw new Error(
          `Lago API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        logger.debug("Lago", "No content response (204)");
        return {} as T;
      }

      const data = await response.json();
      logger.debug("Lago", "Response data received", {
        dataKeys: Object.keys(data),
        dataSize: JSON.stringify(data).length,
      });

      // Validate response with Zod schema
      try {
        const validated = schema.parse(data);
        logger.debug("Lago", "Response validation successful");
        return validated;
      } catch (error) {
        logger.error("Lago", "Response validation failed", {
          error: error instanceof Error ? error.message : String(error),
          receivedData: data,
        });
        throw new Error(`Lago API response validation failed: ${error}`);
      }
    }, {
      maxAttempts: 3,
      initialDelay: 1000,
      logAttempts: true,
    });
  }

  /**
   * Create a single usage event
   *
   * @param event - The event to create
   */
  async createEvent(event: LagoEvent): Promise<void> {
    logger.info("Lago", "Creating single event", {
      transactionId: event.transaction_id,
      subscriptionId: event.external_subscription_id,
      code: event.code,
      properties: event.properties,
    });

    await this.request(
      "/events",
      z.object({}),
      {
        method: "POST",
        body: JSON.stringify({ event }),
      }
    );

    logger.debug("Lago", "Event created successfully", {
      transactionId: event.transaction_id,
    });
  }

  /**
   * Create multiple usage events in a batch
   *
   * More efficient than individual calls.
   * Lago processes up to 100 events per batch.
   *
   * @param events - Array of events to create
   */
  async createBatchEvents(events: LagoEvent[]): Promise<void> {
    if (events.length === 0) {
      logger.debug("Lago", "No events to create in batch");
      return;
    }

    if (events.length > 100) {
      logger.error("Lago", "Batch size exceeds limit", {
        eventCount: events.length,
        limit: 100,
      });
      throw new Error(
        "Lago batch limit is 100 events. Split into smaller batches."
      );
    }

    logger.info("Lago", "Creating batch events", {
      eventCount: events.length,
      transactionIds: events.map((e) => e.transaction_id),
    });

    await this.request(
      "/events/batch",
      z.object({}),
      {
        method: "POST",
        body: JSON.stringify({ events }),
      }
    );

    logger.debug("Lago", "Batch events created successfully", {
      eventCount: events.length,
    });
  }

  /**
   * Get all customers
   *
   * @returns Object with customers array
   */
  async getCustomers(): Promise<{ customers: LagoCustomer[] }> {
    return this.request(
      "/customers",
      z.object({ customers: z.array(LagoCustomerSchema) })
    );
  }

  /**
   * Get a customer by external ID
   *
   * @param externalId - Your external customer ID
   * @returns Object with customer data
   */
  async getCustomer(externalId: string): Promise<{ customer: LagoCustomer }> {
    return this.request(
      `/customers/${encodeURIComponent(externalId)}`,
      z.object({ customer: LagoCustomerSchema })
    );
  }

  /**
   * Get subscriptions, optionally filtered by customer
   *
   * @param externalCustomerId - Optional customer ID to filter by
   * @returns Object with subscriptions array
   */
  async getSubscriptions(
    externalCustomerId?: string
  ): Promise<{ subscriptions: LagoSubscription[] }> {
    const params = externalCustomerId
      ? `?external_customer_id=${encodeURIComponent(externalCustomerId)}`
      : "";
    return this.request(
      `/subscriptions${params}`,
      z.object({ subscriptions: z.array(LagoSubscriptionSchema) })
    );
  }

  /**
   * Get current usage for a subscription
   *
   * @param externalCustomerId - Customer external ID
   * @param externalSubscriptionId - Subscription external ID
   * @returns Current usage data
   */
  async getCurrentUsage(
    externalCustomerId: string,
    externalSubscriptionId: string
  ): Promise<LagoCurrentUsage> {
    const customerId = encodeURIComponent(externalCustomerId);
    const subId = encodeURIComponent(externalSubscriptionId);
    return this.request(
      `/customers/${customerId}/current_usage?external_subscription_id=${subId}`,
      LagoCurrentUsageSchema
    );
  }
}

// Export singleton instance
export const lagoClient = new LagoClient();

