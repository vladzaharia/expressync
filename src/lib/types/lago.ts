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
  timestamp: z.number(),

  /** Usage properties (metric-specific) */
  properties: z.record(z.string(), z.string()),
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

  /** On termination invoice - can be null - REQUIRED */
  on_termination_invoice: z.string().nullable(),

  /** Plan details - optional, only in SubscriptionObjectExtended */
  plan: z.any().optional(),
});

export type LagoSubscription = z.infer<typeof LagoSubscriptionSchema>;

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
