import { z } from "zod";

/**
 * Zod schema for Lago Event
 * Based on lago-api.yml
 */
export const LagoEventSchema = z.object({
  /** Unique identifier for idempotency (prevents duplicates) */
  transaction_id: z.string(),

  /** External ID of the subscription to bill */
  external_subscription_id: z.string(),

  /** Billable metric code (e.g., "ev_charging_kwh") */
  code: z.string(),

  /** Unix timestamp when the usage occurred */
  timestamp: z.union([z.number(), z.string()]),

  /** Usage properties (metric-specific) */
  properties: z.record(z.string(), z.union([z.string(), z.number()])),
});

export type LagoEvent = z.infer<typeof LagoEventSchema>;

/**
 * Zod schema for Lago Subscription
 * Based on lago-api.yml SubscriptionObject schema
 * All required fields per OpenAPI spec are non-optional
 */
export const LagoSubscriptionSchema = z.object({
  /** Lago internal ID */
  lago_id: z.string(),

  /** Your external subscription ID */
  external_id: z.string(),

  /** Lago internal customer ID */
  lago_customer_id: z.string(),

  /** Your external customer ID */
  external_customer_id: z.string(),

  /** Billing time (calendar or anniversary) - REQUIRED */
  billing_time: z.enum(["calendar", "anniversary"]),

  /** Subscription name - can be null - REQUIRED */
  name: z.string().nullable(),

  /** Plan code this subscription uses */
  plan_code: z.string(),

  /** Subscription status */
  status: z.enum(["active", "pending", "terminated", "canceled"]),

  /** Created at timestamp - REQUIRED */
  created_at: z.string(),

  /** Canceled at timestamp - can be null - REQUIRED */
  canceled_at: z.string().nullable(),

  /** Started at timestamp - can be null - REQUIRED */
  started_at: z.string().nullable(),

  /** Ending at timestamp - can be null - REQUIRED */
  ending_at: z.string().nullable(),

  /** Subscription at timestamp - REQUIRED */
  subscription_at: z.string(),

  /** Terminated at timestamp - can be null - REQUIRED */
  terminated_at: z.string().nullable(),

  /** Previous plan code - can be null - REQUIRED */
  previous_plan_code: z.string().nullable(),

  /** Next plan code - can be null - REQUIRED */
  next_plan_code: z.string().nullable(),

  /** Downgrade plan date - can be null - REQUIRED */
  downgrade_plan_date: z.string().nullable(),

  /** Trial ended at timestamp - can be null - REQUIRED */
  trial_ended_at: z.string().nullable(),

  /** Current billing period start - can be null - REQUIRED */
  current_billing_period_started_at: z.string().nullable(),

  /** Current billing period end - can be null - REQUIRED */
  current_billing_period_ending_at: z.string().nullable(),

  /** On termination credit note - can be null - REQUIRED */
  on_termination_credit_note: z.string().nullable(),

  /** On termination invoice - REQUIRED */
  on_termination_invoice: z.enum(["generate", "skip"]),

  /** Plan details - optional, only in SubscriptionObjectExtended */
  plan: z.any().optional(),
});

export type LagoSubscription = z.infer<typeof LagoSubscriptionSchema>;

/**
 * Extended Lago Subscription schema that permits a `metadata` record.
 *
 * Lago's subscription API historically exposes metadata as an array of
 * key/value entries (similar to the customer metadata shape). We accept
 * either an array or a loose record because our P5 charging-profile mirror
 * only writes a single JSON blob under key "charging_profile" — we do not
 * attempt to reinterpret Lago's canonical metadata shape.
 *
 * Used by `lagoClient.getSubscription` / `updateSubscription` for the
 * charging-profile mirror; all other callers continue to use
 * `LagoSubscriptionSchema`.
 */
export const LagoSubscriptionWithMetadataSchema = LagoSubscriptionSchema.extend(
  {
    metadata: z.union([
      z.record(z.string(), z.unknown()),
      z.array(
        z.object({
          key: z.string(),
          value: z.string(),
          lago_id: z.string().optional(),
          display_in_invoice: z.boolean().optional(),
          created_at: z.string().optional(),
        }),
      ),
    ]).optional(),
  },
);

export type LagoSubscriptionWithMetadata = z.infer<
  typeof LagoSubscriptionWithMetadataSchema
>;

/**
 * Zod schema for Lago Customer
 * Based on lago-api.yml CustomerBaseObject schema
 * All required fields per OpenAPI spec are non-optional
 */
export const LagoCustomerSchema = z.object({
  /** Lago internal ID - REQUIRED */
  lago_id: z.string(),

  /** Sequential ID - REQUIRED */
  sequential_id: z.number(),

  /** Slug - REQUIRED */
  slug: z.string(),

  /** Your external customer ID - REQUIRED */
  external_id: z.string(),

  /** Billing entity code - can be null or string */
  billing_entity_code: z.string().optional(),

  /** Customer name - can be null */
  name: z.string().nullable(),

  /** First name - can be null */
  firstname: z.string().nullable(),

  /** Last name - can be null */
  lastname: z.string().nullable(),

  /** Customer email - can be null */
  email: z.string().nullable(),

  /** Account type - enum: customer or partner */
  account_type: z.enum(["customer", "partner"]).optional(),

  /** Customer type - can be null, enum: company or individual */
  customer_type: z.enum(["company", "individual"]).nullable().optional(),

  /** Address line 1 - can be null */
  address_line1: z.string().nullable(),

  /** Address line 2 - can be null */
  address_line2: z.string().nullable(),

  /** City - can be null */
  city: z.string().nullable(),

  /** State - can be null */
  state: z.string().nullable(),

  /** Zipcode - can be null */
  zipcode: z.string().nullable(),

  /** Country - can be null */
  country: z.string().nullable(),

  /** Legal name - can be null */
  legal_name: z.string().nullable(),

  /** Legal number - can be null */
  legal_number: z.string().nullable(),

  /** Tax identification number - can be null */
  tax_identification_number: z.string().nullable(),

  /** Phone - can be null */
  phone: z.string().nullable(),

  /** Logo URL - can be null */
  logo_url: z.string().nullable(),

  /** URL - can be null */
  url: z.string().nullable(),

  /** Currency - can be null */
  currency: z.string().nullable(),

  /** Timezone - can be null */
  timezone: z.string().nullable(),

  /** Applicable timezone - REQUIRED */
  applicable_timezone: z.string(),

  /** Net payment term - can be null */
  net_payment_term: z.number().nullable(),

  /** Finalize zero amount invoice - enum */
  finalize_zero_amount_invoice: z.enum(["inherit", "skip", "finalize"])
    .optional(),

  /** Skip invoice custom sections */
  skip_invoice_custom_sections: z.boolean().optional(),

  /** Created at timestamp - REQUIRED */
  created_at: z.string(),

  /** Updated at timestamp */
  updated_at: z.string().optional(),

  /** Billing configuration */
  billing_configuration: z.object({
    invoice_grace_period: z.number().nullable(),
    payment_provider: z.string().nullable(),
    payment_provider_code: z.string().nullable().optional(),
    document_locale: z.string().nullable(),
    subscription_invoice_issuing_date_anchor: z.string().nullable().optional(),
    subscription_invoice_issuing_date_adjustment: z.string().nullable()
      .optional(),
  }).optional(),

  /** Shipping address */
  shipping_address: z.object({
    address_line1: z.string().nullable().optional(),
    address_line2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    zipcode: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    country: z.string().nullable(),
  }).optional(),

  /** Custom metadata */
  metadata: z.array(
    z.object({
      lago_id: z.string().optional(),
      key: z.string(),
      value: z.string(),
      display_in_invoice: z.boolean().optional(),
      created_at: z.string().optional(),
    }),
  ).optional(),

  /** Taxes */
  taxes: z.array(z.any()).optional(),

  /** Integration customers */
  integration_customers: z.array(z.any()).optional(),
});

export type LagoCustomer = z.infer<typeof LagoCustomerSchema>;

/**
 * Zod schema for Lago Current Usage
 */
export const LagoCurrentUsageSchema = z.object({
  from_datetime: z.string(),
  to_datetime: z.string(),
  issuing_date: z.string(),
  lago_invoice_id: z.string().nullable(),
  currency: z.string(),
  amount_cents: z.number(),
  total_amount_cents: z.number(),
  charges_usage: z.array(
    z.object({
      billable_metric: z.object({
        code: z.string(),
        name: z.string(),
      }),
      units: z.string(),
      amount_cents: z.number(),
    }),
  ),
});

export type LagoCurrentUsage = z.infer<typeof LagoCurrentUsageSchema>;

/**
 * Zod schema for Lago Invoice (basic fields)
 * Based on lago-api.yml InvoiceObject schema
 */
export const LagoInvoiceSchema = z.object({
  /** Lago internal ID */
  lago_id: z.string(),

  /** Sequential ID */
  sequential_id: z.number(),

  /** Invoice number */
  number: z.string(),

  /** Issuing date */
  issuing_date: z.string(),

  /** Payment due date */
  payment_due_date: z.string().nullable(),

  /** Invoice type: credit, one_off, subscription, advance_charges */
  invoice_type: z.string(),

  /** Invoice status: draft, finalized, voided, pending, failed */
  status: z.string(),

  /** Payment status: pending, succeeded, failed */
  payment_status: z.string(),

  /** Currency code */
  currency: z.string(),

  /** Total amount in cents */
  total_amount_cents: z.number(),

  /** Taxes amount in cents */
  taxes_amount_cents: z.number(),

  /** Sub-total excluding taxes in cents */
  sub_total_excluding_taxes_amount_cents: z.number(),

  /** Customer external ID */
  external_customer_id: z.string().optional(),

  /** Created at timestamp */
  created_at: z.string().optional(),

  /** Updated at timestamp */
  updated_at: z.string().optional(),
});

export type LagoInvoice = z.infer<typeof LagoInvoiceSchema>;

/**
 * Request body for creating a Lago event
 */
export interface CreateEventRequest {
  event: LagoEvent;
}

/**
 * Request body for batch creating Lago events
 */
export interface CreateBatchEventsRequest {
  events: LagoEvent[];
}

// ============================================================================
// === Phase D: Lago surface expansion ===
// ============================================================================

/**
 * Lago Billable Metric (minimal)
 *
 * Used by the startup safety gate: the worker fetches this and refuses to
 * enrich event properties unless `aggregation_type === "sum_agg"` — otherwise
 * an accidental metric-config change in the Lago UI could silently break
 * billing.
 */
export const LagoBillableMetricSchema = z.object({
  lago_id: z.string().optional(),
  name: z.string().optional(),
  code: z.string(),
  aggregation_type: z.enum([
    "count_agg",
    "sum_agg",
    "max_agg",
    "unique_count_agg",
    "weighted_sum_agg",
    "latest_agg",
  ]),
  field_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  recurring: z.boolean().optional(),
}).passthrough();

export type LagoBillableMetric = z.infer<typeof LagoBillableMetricSchema>;

/**
 * Lago Wallet
 */
export const LagoWalletSchema = z.object({
  lago_id: z.string(),
  lago_customer_id: z.string().optional(),
  external_customer_id: z.string(),
  status: z.enum(["active", "terminated"]).optional(),
  currency: z.string(),
  name: z.string().nullable().optional(),
  rate_amount: z.string().optional(),
  credits_balance: z.string().optional(),
  balance_cents: z.number().optional(),
  consumed_credits: z.string().optional(),
  created_at: z.string().optional(),
  expiration_at: z.string().nullable().optional(),
  last_balance_sync_at: z.string().nullable().optional(),
  last_consumed_credit_at: z.string().nullable().optional(),
  terminated_at: z.string().nullable().optional(),
}).passthrough();

export type LagoWallet = z.infer<typeof LagoWalletSchema>;

/**
 * Lago Wallet Transaction
 */
export const LagoWalletTransactionSchema = z.object({
  lago_id: z.string(),
  lago_wallet_id: z.string().optional(),
  status: z.enum(["pending", "settled", "failed"]).optional(),
  transaction_status: z.enum(["purchased", "granted", "voided", "invoiced"])
    .optional(),
  transaction_type: z.enum(["inbound", "outbound"]).optional(),
  amount: z.string().optional(),
  credit_amount: z.string().optional(),
  created_at: z.string().optional(),
  settled_at: z.string().nullable().optional(),
  failed_at: z.string().nullable().optional(),
  invoice_requires_successful_payment: z.boolean().optional(),
}).passthrough();

export type LagoWalletTransaction = z.infer<typeof LagoWalletTransactionSchema>;

/**
 * Lago Coupon
 */
export const LagoCouponSchema = z.object({
  lago_id: z.string(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable().optional(),
  coupon_type: z.enum(["fixed_amount", "percentage"]).optional(),
  amount_cents: z.number().optional(),
  amount_currency: z.string().optional(),
  percentage_rate: z.string().optional(),
  expiration: z.enum(["time_limit", "no_expiration"]).optional(),
  expiration_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
}).passthrough();

export type LagoCoupon = z.infer<typeof LagoCouponSchema>;

/**
 * Lago Applied Coupon
 */
export const LagoAppliedCouponSchema = z.object({
  lago_id: z.string(),
  lago_coupon_id: z.string().optional(),
  coupon_code: z.string().optional(),
  external_customer_id: z.string(),
  status: z.enum(["active", "terminated"]).optional(),
  amount_cents: z.number().optional(),
  amount_currency: z.string().optional(),
  percentage_rate: z.string().optional(),
  created_at: z.string().optional(),
  terminated_at: z.string().nullable().optional(),
}).passthrough();

export type LagoAppliedCoupon = z.infer<typeof LagoAppliedCouponSchema>;

/**
 * Subscription Alert (usage / percentage thresholds)
 */
export const LagoSubscriptionAlertSchema = z.object({
  lago_id: z.string(),
  code: z.string().optional(),
  name: z.string().nullable().optional(),
  alert_type: z.string().optional(),
  subscription_external_id: z.string(),
  billable_metric_code: z.string().nullable().optional(),
  thresholds: z.array(
    z.object({
      code: z.string().optional(),
      value: z.string(),
      recurring: z.boolean().optional(),
    }),
  ).optional(),
  created_at: z.string().optional(),
}).passthrough();

export type LagoSubscriptionAlert = z.infer<
  typeof LagoSubscriptionAlertSchema
>;

/**
 * Lago Credit Note
 */
export const LagoCreditNoteSchema = z.object({
  lago_id: z.string(),
  sequential_id: z.number().optional(),
  number: z.string().optional(),
  lago_invoice_id: z.string().optional(),
  invoice_number: z.string().optional(),
  issuing_date: z.string().optional(),
  credit_status: z.string().optional(),
  refund_status: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  total_amount_cents: z.number().optional(),
  currency: z.string().optional(),
  file_url: z.string().nullable().optional(),
}).passthrough();

export type LagoCreditNote = z.infer<typeof LagoCreditNoteSchema>;

/**
 * Lago Payment
 */
export const LagoPaymentSchema = z.object({
  lago_id: z.string(),
  payable_type: z.string().optional(),
  invoice_ids: z.array(z.string()).optional(),
  amount_cents: z.number().optional(),
  amount_currency: z.string().optional(),
  payment_status: z.string().optional(),
  type: z.string().optional(),
  reference: z.string().nullable().optional(),
  created_at: z.string().optional(),
}).passthrough();

export type LagoPayment = z.infer<typeof LagoPaymentSchema>;

/**
 * Lago Lifetime Usage (subscription-level)
 */
export const LagoLifetimeUsageSchema = z.object({
  lago_id: z.string().optional(),
  from_datetime: z.string().optional(),
  to_datetime: z.string().optional(),
  external_subscription_id: z.string(),
  invoiced_usage_amount_cents: z.number().optional(),
  current_usage_amount_cents: z.number().optional(),
  total_usage_amount_cents: z.number().optional(),
  total_usage_from_datetime: z.string().optional(),
  total_usage_to_datetime: z.string().optional(),
  currency: z.string().optional(),
  usage_thresholds: z.array(z.any()).optional(),
}).passthrough();

export type LagoLifetimeUsage = z.infer<typeof LagoLifetimeUsageSchema>;

/**
 * Extended Lago Invoice — includes `file_url`, `fees[]`, `applied_taxes[]`
 *
 * Returned by `GET /invoices/{id}` (detail) but not by the list endpoint.
 */
export const LagoInvoiceExtendedSchema = LagoInvoiceSchema.extend({
  file_url: z.string().nullable().optional(),
  fees: z.array(z.any()).optional(),
  fees_amount_cents: z.number().optional(),
  applied_taxes: z.array(z.any()).optional(),
  payment_overdue: z.boolean().optional(),
  customer: z.any().optional(),
  subscriptions: z.array(z.any()).optional(),
  credit_notes: z.array(z.any()).optional(),
  payments: z.array(z.any()).optional(),
}).passthrough();

export type LagoInvoiceExtended = z.infer<typeof LagoInvoiceExtendedSchema>;

/**
 * Apply-coupon request — enforces mutual exclusivity between `coupon_code`
 * and `lago_coupon_id` at the schema level so callers get a clear validation
 * error instead of a vague Lago 422.
 */
export const ApplyCouponPayloadSchema = z.object({
  external_customer_id: z.string(),
  coupon_code: z.string().optional(),
  lago_coupon_id: z.string().optional(),
  amount_cents: z.number().int().optional(),
  amount_currency: z.string().optional(),
  percentage_rate: z.string().optional(),
  frequency: z.enum(["once", "recurring", "forever"]).optional(),
  frequency_duration: z.number().int().optional(),
}).refine(
  (v) => Boolean(v.coupon_code) !== Boolean(v.lago_coupon_id),
  {
    message: "Provide exactly one of `coupon_code` or `lago_coupon_id`",
    path: ["coupon_code"],
  },
);

export type ApplyCouponPayload = z.infer<typeof ApplyCouponPayloadSchema>;

// ----------------------------------------------------------------------------
// Webhook payloads — discriminated union keyed on `webhook_type`
// ----------------------------------------------------------------------------
//
// Lago sends webhooks as `{ webhook_type: string, object_type?: string, <object_type>: {...} }`.
// We enumerate ≥20 known types so the discriminator can route to a typed
// handler. Unknown types fall through to a `passthrough` catch-all so we still
// log + persist them in the audit table.

const WebhookBase = {
  webhook_type: z.string(),
  object_type: z.string().optional(),
};

/** Invoice status changes — MVP reaction target when payment_status=failed */
export const InvoicePaymentStatusUpdatedWebhookSchema = z.object({
  ...WebhookBase,
  webhook_type: z.literal("invoice.payment_status_updated"),
  invoice: LagoInvoiceExtendedSchema.partial().extend({
    lago_id: z.string(),
    payment_status: z.string().optional(),
    status: z.string().optional(),
    customer: z.any().optional(),
  }),
}).passthrough();

/** Alert triggered — MVP reaction */
export const AlertTriggeredWebhookSchema = z.object({
  ...WebhookBase,
  webhook_type: z.literal("alert.triggered"),
  alert: z.object({
    lago_id: z.string().optional(),
    code: z.string().optional(),
    alert_type: z.string().optional(),
    subscription_external_id: z.string().optional(),
    current_value: z.union([z.string(), z.number()]).optional(),
    previous_value: z.union([z.string(), z.number()]).optional(),
    triggered_at: z.string().optional(),
    triggered_thresholds: z.array(z.any()).optional(),
  }).passthrough(),
}).passthrough();

/** Wallet transaction payment failure — MVP reaction */
export const WalletTransactionPaymentFailureWebhookSchema = z.object({
  ...WebhookBase,
  webhook_type: z.literal("wallet_transaction.payment_failure"),
  wallet_transaction: z.object({
    lago_id: z.string().optional(),
    lago_wallet_id: z.string().optional(),
    external_customer_id: z.string().optional(),
    status: z.string().optional(),
    amount: z.string().optional(),
    failed_at: z.string().nullable().optional(),
    provider_error: z.any().optional(),
  }).passthrough(),
}).passthrough();

// Convenience constructor for "simple" webhook types we want to type-narrow
// but that don't have specific reaction logic yet.
const simpleWebhook = <T extends string>(tag: T) =>
  z.object({
    ...WebhookBase,
    webhook_type: z.literal(tag),
  }).passthrough();

/**
 * Invoice lifecycle webhooks — lightweight invoice projection so reactTo
 * can access number/status/amount without an extra Lago fetch.
 */
const invoiceLifecyclePayload = z.object({
  lago_id: z.string(),
  number: z.string().nullable().optional(),
  status: z.string().optional(),
  payment_status: z.string().optional(),
  invoice_type: z.string().optional(),
  total_amount_cents: z.number().optional(),
  currency: z.string().optional(),
  customer: z.object({
    external_id: z.string().optional(),
    name: z.string().nullable().optional(),
  }).passthrough().optional(),
}).passthrough();

const invoiceLifecycleWebhook = <T extends string>(tag: T) =>
  z.object({
    ...WebhookBase,
    webhook_type: z.literal(tag),
    invoice: invoiceLifecyclePayload.optional(),
  }).passthrough();

export const InvoiceCreatedWebhookSchema = invoiceLifecycleWebhook(
  "invoice.created",
);
export const InvoiceDraftedWebhookSchema = invoiceLifecycleWebhook(
  "invoice.drafted",
);
export const InvoiceGeneratedWebhookSchema = invoiceLifecycleWebhook(
  "invoice.generated",
);
export const InvoiceVoidedWebhookSchema = simpleWebhook("invoice.voided");
export const InvoiceResyncedWebhookSchema = simpleWebhook("invoice.resynced");
export const InvoicePaymentFailureWebhookSchema = simpleWebhook(
  "invoice.payment_failure",
);
export const InvoicePaymentOverdueWebhookSchema = simpleWebhook(
  "invoice.payment_overdue",
);
export const InvoicePaymentDisputeLostWebhookSchema = simpleWebhook(
  "invoice.payment_dispute_lost",
);
export const InvoiceOneOffCreatedWebhookSchema = simpleWebhook(
  "invoice.one_off_created",
);
export const InvoicePaidCreditAddedWebhookSchema = simpleWebhook(
  "invoice.paid_credit_added",
);
export const InvoiceAddOnAddedWebhookSchema = simpleWebhook(
  "invoice.add_on_added",
);
export const SubscriptionStartedWebhookSchema = simpleWebhook(
  "subscription.started",
);
export const SubscriptionTerminatedWebhookSchema = simpleWebhook(
  "subscription.terminated",
);
export const SubscriptionUpdatedWebhookSchema = simpleWebhook(
  "subscription.updated",
);
export const SubscriptionTerminationAlertWebhookSchema = simpleWebhook(
  "subscription.termination_alert",
);
export const SubscriptionTrialEndedWebhookSchema = simpleWebhook(
  "subscription.trial_ended",
);
export const SubscriptionUsageThresholdReachedWebhookSchema = simpleWebhook(
  "subscription.usage_threshold_reached",
);
export const CreditNoteCreatedWebhookSchema = simpleWebhook(
  "credit_note.created",
);
export const CreditNoteGeneratedWebhookSchema = simpleWebhook(
  "credit_note.generated",
);
export const CreditNoteRefundFailureWebhookSchema = simpleWebhook(
  "credit_note.refund_failure",
);
export const PaymentRequiresActionWebhookSchema = simpleWebhook(
  "payment.requires_action",
);
export const PaymentRequestCreatedWebhookSchema = simpleWebhook(
  "payment_request.created",
);
export const PaymentRequestPaymentFailureWebhookSchema = simpleWebhook(
  "payment_request.payment_failure",
);
export const PaymentRequestPaymentStatusUpdatedWebhookSchema = simpleWebhook(
  "payment_request.payment_status_updated",
);
export const WalletTransactionCreatedWebhookSchema = simpleWebhook(
  "wallet_transaction.created",
);
export const WalletTransactionUpdatedWebhookSchema = simpleWebhook(
  "wallet_transaction.updated",
);
export const WalletDepletedOngoingBalanceWebhookSchema = simpleWebhook(
  "wallet.depleted_ongoing_balance",
);
export const FeeCreatedWebhookSchema = simpleWebhook("fee.created");
export const EventErrorWebhookSchema = simpleWebhook("event.error");
export const EventsErrorsWebhookSchema = simpleWebhook("events.errors");
export const CustomerCreatedWebhookSchema = simpleWebhook("customer.created");
export const CustomerUpdatedWebhookSchema = simpleWebhook("customer.updated");

/**
 * Discriminated union of every webhook we explicitly know how to parse.
 *
 * Zod's `discriminatedUnion` requires each branch to be a `ZodObject` with a
 * literal discriminator — passthrough is fine, refinements are not. Unknown
 * types are handled in the dispatcher by falling back to a bare passthrough
 * `LagoWebhookEnvelopeSchema` so we can still persist + log them.
 */
export const LagoWebhookSchema = z.discriminatedUnion("webhook_type", [
  InvoicePaymentStatusUpdatedWebhookSchema,
  AlertTriggeredWebhookSchema,
  WalletTransactionPaymentFailureWebhookSchema,
  InvoiceCreatedWebhookSchema,
  InvoiceDraftedWebhookSchema,
  InvoiceGeneratedWebhookSchema,
  InvoiceVoidedWebhookSchema,
  InvoiceResyncedWebhookSchema,
  InvoicePaymentFailureWebhookSchema,
  InvoicePaymentOverdueWebhookSchema,
  InvoicePaymentDisputeLostWebhookSchema,
  InvoiceOneOffCreatedWebhookSchema,
  InvoicePaidCreditAddedWebhookSchema,
  InvoiceAddOnAddedWebhookSchema,
  SubscriptionStartedWebhookSchema,
  SubscriptionTerminatedWebhookSchema,
  SubscriptionUpdatedWebhookSchema,
  SubscriptionTerminationAlertWebhookSchema,
  SubscriptionTrialEndedWebhookSchema,
  SubscriptionUsageThresholdReachedWebhookSchema,
  CreditNoteCreatedWebhookSchema,
  CreditNoteGeneratedWebhookSchema,
  CreditNoteRefundFailureWebhookSchema,
  PaymentRequiresActionWebhookSchema,
  PaymentRequestCreatedWebhookSchema,
  PaymentRequestPaymentFailureWebhookSchema,
  PaymentRequestPaymentStatusUpdatedWebhookSchema,
  WalletTransactionCreatedWebhookSchema,
  WalletTransactionUpdatedWebhookSchema,
  WalletDepletedOngoingBalanceWebhookSchema,
  FeeCreatedWebhookSchema,
  EventErrorWebhookSchema,
  EventsErrorsWebhookSchema,
  CustomerCreatedWebhookSchema,
  CustomerUpdatedWebhookSchema,
]);

export type LagoWebhook = z.infer<typeof LagoWebhookSchema>;

/**
 * Envelope-only parse: permissive catch-all for unknown webhook types. The
 * dispatcher parses the discriminated union first, falls back to this, and
 * still persists + logs so we don't lose visibility on new Lago releases.
 */
export const LagoWebhookEnvelopeSchema = z.object({
  webhook_type: z.string(),
  object_type: z.string().optional(),
}).passthrough();

export type LagoWebhookEnvelope = z.infer<typeof LagoWebhookEnvelopeSchema>;
