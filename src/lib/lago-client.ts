import { config } from "./config.ts";
import {
  type LagoCurrentUsage,
  LagoCurrentUsageSchema,
  type LagoCustomer,
  LagoCustomerSchema,
  type LagoEvent,
  LagoEventSchema,
  type LagoInvoice,
  LagoInvoiceSchema,
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
    options: RequestInit = {},
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
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
            `Lago API error: ${response.status} ${response.statusText} - ${errorText}`,
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
   * Fetch all pages of a paginated Lago endpoint
   */
  private async requestAllPages<T>(
    path: string,
    dataKey: string,
    itemSchema: z.ZodSchema<T>,
  ): Promise<T[]> {
    const MAX_PAGES = 100;
    const allItems: T[] = [];
    let page = 1;
    while (true) {
      if (page > MAX_PAGES) {
        logger.warn("Lago", "Max page limit reached", { path, page });
        break;
      }
      const separator = path.includes('?') ? '&' : '?';
      const data = await this.request(
        `${path}${separator}page=${page}&per_page=100`,
        z.object({ [dataKey]: z.array(itemSchema) }).passthrough(),
      );
      allItems.push(...data[dataKey]);
      if (data[dataKey].length < 100) break;
      page++;
    }
    return allItems;
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
      },
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
        "Lago batch limit is 100 events. Split into smaller batches.",
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
      },
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
    const customers = await this.requestAllPages(
      "/customers",
      "customers",
      LagoCustomerSchema,
    );
    return { customers };
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
      z.object({ customer: LagoCustomerSchema }),
    );
  }

  /**
   * Get subscriptions, optionally filtered by customer
   *
   * @param externalCustomerId - Optional customer ID to filter by
   * @returns Object with subscriptions array
   */
  async getSubscriptions(
    externalCustomerId?: string,
  ): Promise<{ subscriptions: LagoSubscription[] }> {
    const params = externalCustomerId
      ? `?external_customer_id=${encodeURIComponent(externalCustomerId)}`
      : "";
    const subscriptions = await this.requestAllPages(
      `/subscriptions${params}`,
      "subscriptions",
      LagoSubscriptionSchema,
    );
    return { subscriptions };
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
    externalSubscriptionId: string,
  ): Promise<LagoCurrentUsage> {
    const customerId = encodeURIComponent(externalCustomerId);
    const subId = encodeURIComponent(externalSubscriptionId);
    const result = await this.request(
      `/customers/${customerId}/current_usage?external_subscription_id=${subId}`,
      z.object({ customer_usage: LagoCurrentUsageSchema }),
    );
    return result.customer_usage;
  }

  /**
   * Get invoices with pagination
   *
   * @param page - Page number (default: 1)
   * @param perPage - Items per page (default: 20)
   * @returns Object with invoices array and pagination meta
   */
  async getInvoices(
    page: number = 1,
    perPage: number = 20,
  ): Promise<{
    invoices: LagoInvoice[];
    meta: { current_page: number; total_pages: number; total_count: number };
  }> {
    const result = await this.request(
      `/invoices?page=${page}&per_page=${perPage}`,
      z.object({
        invoices: z.array(LagoInvoiceSchema),
        meta: z.object({
          current_page: z.number(),
          total_pages: z.number(),
          total_count: z.number(),
        }),
      }),
    );

    return result;
  }
}

// Export singleton instance
export const lagoClient = new LagoClient();
