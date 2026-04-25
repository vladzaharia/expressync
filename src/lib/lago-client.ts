import { config } from "./config.ts";
import {
  type ApplyCouponPayload,
  ApplyCouponPayloadSchema,
  type LagoAppliedCoupon,
  LagoAppliedCouponSchema,
  type LagoBillableMetric,
  LagoBillableMetricSchema,
  type LagoCurrentUsage,
  LagoCurrentUsageSchema,
  type LagoCustomer,
  LagoCustomerSchema,
  type LagoEvent,
  type LagoInvoice,
  type LagoInvoiceExtended,
  LagoInvoiceExtendedSchema,
  LagoInvoiceSchema,
  type LagoLifetimeUsage,
  LagoLifetimeUsageSchema,
  type LagoPlan,
  LagoPlanSchema,
  type LagoSubscription,
  type LagoSubscriptionAlert,
  LagoSubscriptionAlertSchema,
  LagoSubscriptionSchema,
  type LagoSubscriptionWithMetadata,
  LagoSubscriptionWithMetadataSchema,
  type LagoWallet,
  LagoWalletSchema,
  type LagoWalletTransaction,
  LagoWalletTransactionSchema,
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
    return await retry(async () => {
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
      const separator = path.includes("?") ? "&" : "?";
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
    return await this.request(
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
   * Get a single subscription by external ID.
   *
   * Uses the metadata-tolerant schema so callers that need to read
   * the charging-profile mirror can see the `metadata` field. All
   * other consumers should prefer `getSubscriptions`.
   */
  getSubscription(
    externalId: string,
  ): Promise<{ subscription: LagoSubscriptionWithMetadata }> {
    return this.request(
      `/subscriptions/${encodeURIComponent(externalId)}`,
      z.object({ subscription: LagoSubscriptionWithMetadataSchema }),
    );
  }

  /**
   * Update a subscription (currently used for charging-profile metadata mirror).
   *
   * Lago's subscription update endpoint accepts a partial `subscription`
   * object. We only send the `metadata` field; callers are responsible for
   * merging (getSubscription first, then update with the new metadata) if
   * they need to preserve existing keys.
   */
  async updateSubscription(
    externalId: string,
    patch: { metadata?: Record<string, unknown> },
  ): Promise<void> {
    await this.request(
      `/subscriptions/${encodeURIComponent(externalId)}`,
      z.object({}).passthrough(),
      {
        method: "PUT",
        body: JSON.stringify({ subscription: patch }),
      },
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

  /**
   * List invoices with optional filters. Returns extended invoice records so
   * callers can consume `customer`, `subscriptions`, `file_url`, and
   * `payment_overdue` directly.
   */
  async listInvoices(opts: {
    externalCustomerId?: string;
    externalSubscriptionId?: string;
    status?: string | string[];
    paymentStatus?: string | string[];
    paymentOverdue?: boolean;
    issuingDateFrom?: string;
    issuingDateTo?: string;
    searchTerm?: string;
    page?: number;
    perPage?: number;
  } = {}): Promise<{
    invoices: LagoInvoiceExtended[];
    meta: { current_page: number; total_pages: number; total_count: number };
  }> {
    const params = new URLSearchParams();
    params.set("page", String(opts.page ?? 1));
    params.set("per_page", String(opts.perPage ?? 20));
    if (opts.externalCustomerId) {
      params.set("external_customer_id", opts.externalCustomerId);
    }
    if (opts.externalSubscriptionId) {
      params.set("external_subscription_id", opts.externalSubscriptionId);
    }
    if (opts.status) {
      const arr = Array.isArray(opts.status) ? opts.status : [opts.status];
      for (const s of arr) params.append("status[]", s);
    }
    if (opts.paymentStatus) {
      const arr = Array.isArray(opts.paymentStatus)
        ? opts.paymentStatus
        : [opts.paymentStatus];
      for (const s of arr) params.append("payment_status[]", s);
    }
    if (opts.paymentOverdue !== undefined) {
      params.set("payment_overdue", String(opts.paymentOverdue));
    }
    if (opts.issuingDateFrom) {
      params.set("issuing_date_from", opts.issuingDateFrom);
    }
    if (opts.issuingDateTo) {
      params.set("issuing_date_to", opts.issuingDateTo);
    }
    if (opts.searchTerm) params.set("search_term", opts.searchTerm);

    return await this.request(
      `/invoices?${params.toString()}`,
      z.object({
        invoices: z.array(LagoInvoiceExtendedSchema),
        meta: z.object({
          current_page: z.number(),
          total_pages: z.number(),
          total_count: z.number(),
        }),
      }),
    );
  }

  // ==========================================================================
  // === Phase D: Lago surface expansion ===
  // ==========================================================================

  /**
   * Fetch a single invoice by Lago ID (extended fields including `file_url`,
   * `fees[]`, `applied_taxes[]`).
   */
  async getInvoice(
    lagoId: string,
  ): Promise<{ invoice: LagoInvoiceExtended }> {
    return await this.request(
      `/invoices/${encodeURIComponent(lagoId)}`,
      z.object({ invoice: LagoInvoiceExtendedSchema }),
    );
  }

  /**
   * Finalize a draft invoice. Fails if already finalized.
   */
  async finalizeInvoice(
    lagoId: string,
  ): Promise<{ invoice: LagoInvoiceExtended }> {
    return await this.request(
      `/invoices/${encodeURIComponent(lagoId)}/finalize`,
      z.object({ invoice: LagoInvoiceExtendedSchema }),
      { method: "PUT" },
    );
  }

  /**
   * Void a finalized invoice. Body is optional; we pass an empty object so the
   * Content-Type header is respected upstream.
   */
  async voidInvoice(
    lagoId: string,
    body: Record<string, unknown> = {},
  ): Promise<{ invoice: LagoInvoiceExtended }> {
    return await this.request(
      `/invoices/${encodeURIComponent(lagoId)}/void`,
      z.object({ invoice: LagoInvoiceExtendedSchema }),
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  /**
   * Refresh a draft invoice — re-computes fees against current usage.
   */
  async refreshInvoice(
    lagoId: string,
  ): Promise<{ invoice: LagoInvoiceExtended }> {
    return await this.request(
      `/invoices/${encodeURIComponent(lagoId)}/refresh`,
      z.object({ invoice: LagoInvoiceExtendedSchema }),
      { method: "PUT" },
    );
  }

  /**
   * Retry a failed invoice payment.
   */
  async retryPayment(
    lagoId: string,
  ): Promise<{ invoice: LagoInvoiceExtended }> {
    return await this.request(
      `/invoices/${encodeURIComponent(lagoId)}/retry_payment`,
      z.object({ invoice: LagoInvoiceExtendedSchema }),
      { method: "POST" },
    );
  }

  /**
   * Trigger async PDF generation for an invoice.
   *
   * Lago responds with the invoice object; `file_url` may be null until the
   * background job completes. Callers should poll `getInvoice` until the URL
   * populates.
   */
  async downloadInvoicePdf(
    lagoId: string,
  ): Promise<{ invoice: LagoInvoiceExtended }> {
    return await this.request(
      `/invoices/${encodeURIComponent(lagoId)}/download`,
      z.object({ invoice: LagoInvoiceExtendedSchema }),
      { method: "POST" },
    );
  }

  /**
   * Create (or upsert) a customer. Lago's `POST /customers` is upsert-by-
   * external_id semantics.
   */
  async createCustomer(
    payload: Record<string, unknown>,
  ): Promise<{ customer: LagoCustomer }> {
    return await this.request(
      `/customers`,
      z.object({ customer: LagoCustomerSchema }),
      { method: "POST", body: JSON.stringify({ customer: payload }) },
    );
  }

  /**
   * Update a customer — same endpoint as `createCustomer` (upsert). We keep
   * the two methods separate for call-site intent, but both map to POST.
   */
  async updateCustomer(
    externalId: string,
    payload: Record<string, unknown>,
  ): Promise<{ customer: LagoCustomer }> {
    const body = { customer: { ...payload, external_id: externalId } };
    return await this.request(
      `/customers`,
      z.object({ customer: LagoCustomerSchema }),
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  /**
   * Get the signed portal URL for a customer (iframe-able self-service).
   */
  async getCustomerPortalUrl(
    externalId: string,
  ): Promise<{ customer: { portal_url: string } }> {
    return await this.request(
      `/customer_portal/${encodeURIComponent(externalId)}/url`,
      z.object({ customer: z.object({ portal_url: z.string() }) }),
    );
  }

  /**
   * Create a wallet for a customer.
   */
  async createWallet(
    payload: Record<string, unknown>,
  ): Promise<{ wallet: LagoWallet }> {
    return await this.request(
      `/wallets`,
      z.object({ wallet: LagoWalletSchema }),
      { method: "POST", body: JSON.stringify({ wallet: payload }) },
    );
  }

  /**
   * Fetch a wallet by its Lago ID.
   */
  async getWallet(lagoId: string): Promise<{ wallet: LagoWallet }> {
    return await this.request(
      `/wallets/${encodeURIComponent(lagoId)}`,
      z.object({ wallet: LagoWalletSchema }),
    );
  }

  /**
   * List wallet transactions (paginated).
   */
  async listWalletTransactions(
    walletId: string,
    params: { page?: number; perPage?: number } = {},
  ): Promise<{
    wallet_transactions: LagoWalletTransaction[];
    meta?: { current_page: number; total_pages: number; total_count: number };
  }> {
    const page = params.page ?? 1;
    const perPage = params.perPage ?? 20;
    return await this.request(
      `/wallets/${
        encodeURIComponent(walletId)
      }/wallet_transactions?page=${page}&per_page=${perPage}`,
      z.object({
        wallet_transactions: z.array(LagoWalletTransactionSchema),
        meta: z.object({
          current_page: z.number(),
          total_pages: z.number(),
          total_count: z.number(),
        }).optional(),
      }),
    );
  }

  /**
   * Add credit to a wallet (inbound wallet_transaction).
   */
  async addWalletCredit(
    walletId: string,
    params: {
      paid_credits?: string;
      granted_credits?: string;
      invoice_requires_successful_payment?: boolean;
      metadata?: Array<{ key: string; value: string }>;
    },
  ): Promise<{ wallet_transactions: LagoWalletTransaction[] }> {
    return await this.request(
      `/wallet_transactions`,
      z.object({
        wallet_transactions: z.array(LagoWalletTransactionSchema),
      }),
      {
        method: "POST",
        body: JSON.stringify({
          wallet_transaction: { wallet_id: walletId, ...params },
        }),
      },
    );
  }

  /**
   * Apply a coupon to a customer. Schema enforces exactly one of
   * `coupon_code` or `lago_coupon_id` (mutual exclusivity).
   */
  async applyCoupon(
    payload: ApplyCouponPayload,
  ): Promise<{ applied_coupon: LagoAppliedCoupon }> {
    const validated = ApplyCouponPayloadSchema.parse(payload);
    return await this.request(
      `/applied_coupons`,
      z.object({ applied_coupon: LagoAppliedCouponSchema }),
      {
        method: "POST",
        body: JSON.stringify({ applied_coupon: validated }),
      },
    );
  }

  /**
   * Remove an applied coupon from a customer.
   */
  async removeCoupon(
    externalCustomerId: string,
    appliedCouponId: string,
  ): Promise<{ applied_coupon: LagoAppliedCoupon }> {
    return await this.request(
      `/customers/${encodeURIComponent(externalCustomerId)}/applied_coupons/${
        encodeURIComponent(appliedCouponId)
      }`,
      z.object({ applied_coupon: LagoAppliedCouponSchema }),
      { method: "DELETE" },
    );
  }

  /**
   * Create a subscription alert (usage/percentage threshold).
   */
  async createSubscriptionAlert(
    subscriptionExternalId: string,
    payload: Record<string, unknown>,
  ): Promise<{ alert: LagoSubscriptionAlert }> {
    const body = {
      alert: {
        ...payload,
        subscription_external_id: subscriptionExternalId,
      },
    };
    return await this.request(
      `/alerts`,
      z.object({ alert: LagoSubscriptionAlertSchema }),
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  /**
   * List alerts for a subscription.
   */
  async getSubscriptionAlerts(
    subscriptionExternalId: string,
  ): Promise<{ alerts: LagoSubscriptionAlert[] }> {
    const alerts = await this.requestAllPages(
      `/alerts?subscription_external_id=${
        encodeURIComponent(subscriptionExternalId)
      }`,
      "alerts",
      LagoSubscriptionAlertSchema,
    );
    return { alerts };
  }

  /**
   * Lifetime usage for a subscription (all-time totals).
   */
  async getLifetimeUsage(
    subscriptionExternalId: string,
  ): Promise<{ lifetime_usage: LagoLifetimeUsage }> {
    return await this.request(
      `/subscriptions/${
        encodeURIComponent(subscriptionExternalId)
      }/lifetime_usage`,
      z.object({ lifetime_usage: LagoLifetimeUsageSchema }),
    );
  }

  /**
   * Fetch a billable metric by its code. Used by the startup safety gate to
   * verify `aggregation_type === "sum_agg"` before enriching event properties.
   */
  async getBillableMetric(
    code: string,
  ): Promise<{ billable_metric: LagoBillableMetric }> {
    return await this.request(
      `/billable_metrics/${encodeURIComponent(code)}`,
      z.object({ billable_metric: LagoBillableMetricSchema }),
    );
  }

  /**
   * Create a one-off invoice with add-on line items.
   *
   * Lago OSS v1.45 has no `/applied_add_ons` endpoint — one-off add-on
   * billing goes through `POST /invoices` with `InvoiceOneOffCreateInput`.
   * See `lago-api.yml` section `InvoiceOneOffCreateInput`.
   */
  async createOneOffInvoice(input: {
    external_customer_id: string;
    currency: string;
    fees: Array<{
      add_on_code: string;
      units?: number;
      description?: string;
      invoice_display_name?: string;
    }>;
  }): Promise<{ invoice: LagoInvoice }> {
    return await this.request(
      "/invoices",
      z.object({ invoice: LagoInvoiceSchema }),
      {
        method: "POST",
        body: JSON.stringify({ invoice: input }),
      },
    );
  }

  /**
   * Apply a coupon to a customer. The coupon attaches to the customer's
   * next invoice (if frequency=once) or to every invoice until exhausted
   * (recurring / forever).
   */
  async createAppliedCoupon(input: {
    external_customer_id: string;
    coupon_code: string;
  }): Promise<{ applied_coupon: LagoAppliedCoupon }> {
    return await this.request(
      "/applied_coupons",
      z.object({ applied_coupon: LagoAppliedCouponSchema }),
      {
        method: "POST",
        body: JSON.stringify({ applied_coupon: input }),
      },
    );
  }

  /**
   * Terminate an applied coupon (e.g. when flipping a user back from
   * `comped` to `standard`).
   */
  async terminateAppliedCoupon(lagoAppliedCouponId: string): Promise<void> {
    await this.request(
      `/applied_coupons/${encodeURIComponent(lagoAppliedCouponId)}`,
      z.object({}).passthrough(),
      { method: "DELETE" },
    );
  }

  /**
   * Fetch Lago's webhook-signing RSA public key (base64-encoded PEM).
   *
   * Lago returns a base64 blob whose decoded contents are a standard
   * `-----BEGIN PUBLIC KEY----- … -----END PUBLIC KEY-----` PEM. Callers
   * typically cache the result for an hour and re-fetch on verification
   * failure.
   */
  /**
   * List every plan. Used by the Lago reconcile job to keep a local plan
   * cache in sync — Lago plans are relatively low-churn so this is cheap.
   */
  async listPlans(): Promise<{ plans: LagoPlan[] }> {
    const plans = await this.requestAllPages(
      "/plans",
      "plans",
      LagoPlanSchema,
    );
    return { plans };
  }

  /**
   * Fetch a single plan by code. The `LagoPlanSchema` passes through any
   * additional fields Lago returns — most importantly the `charges` array
   * with per-metric `charge_model` + `properties` (tiered/volume pricing).
   * Callers read these raw off the returned object.
   */
  async getPlan(code: string): Promise<LagoPlan> {
    const res = await this.request(
      `/plans/${encodeURIComponent(code)}`,
      z.object({ plan: LagoPlanSchema }),
    );
    return res.plan;
  }

  /**
   * List every billable metric. Used by the reconcile job. The existing
   * `getBillableMetric(code)` is kept for the startup safety gate.
   */
  async listBillableMetrics(): Promise<{
    billable_metrics: LagoBillableMetric[];
  }> {
    const billable_metrics = await this.requestAllPages(
      "/billable_metrics",
      "billable_metrics",
      LagoBillableMetricSchema,
    );
    return { billable_metrics };
  }

  /**
   * List wallets for a specific customer. Lago's `/wallets` endpoint requires
   * `external_customer_id`, so the reconciler iterates customers.
   */
  async listWalletsForCustomer(
    externalCustomerId: string,
  ): Promise<{ wallets: LagoWallet[] }> {
    const wallets = await this.requestAllPages(
      `/wallets?external_customer_id=${encodeURIComponent(externalCustomerId)}`,
      "wallets",
      LagoWalletSchema,
    );
    return { wallets };
  }

  /**
   * List every invoice (all pages). Returns extended invoice records so the
   * reconciler can denormalize fees. Lightweight wrapper over `listInvoices`
   * that walks pagination.
   */
  async listAllInvoices(opts: {
    status?: string | string[];
    paymentStatus?: string | string[];
  } = {}): Promise<{ invoices: LagoInvoiceExtended[] }> {
    const all: LagoInvoiceExtended[] = [];
    const MAX_PAGES = 200;
    let page = 1;
    while (true) {
      if (page > MAX_PAGES) {
        logger.warn("Lago", "listAllInvoices: max page limit reached", {
          page,
        });
        break;
      }
      const { invoices, meta } = await this.listInvoices({
        ...opts,
        page,
        perPage: 100,
      });
      all.push(...invoices);
      if (page >= meta.total_pages || invoices.length < 100) break;
      page++;
    }
    return { invoices: all };
  }

  async getWebhookPublicKey(): Promise<string> {
    const url = `${this.baseUrl}/webhooks/public_key`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Lago /webhooks/public_key failed: ${response.status} ${response.statusText} - ${body}`,
        );
      }
      const base64 = (await response.text()).trim();
      try {
        return atob(base64);
      } catch (err) {
        throw new Error(
          `Lago /webhooks/public_key returned non-base64 body: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Export singleton instance
export const lagoClient = new LagoClient();
