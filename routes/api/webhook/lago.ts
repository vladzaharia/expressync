import { define } from "../../../utils.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const webhookLogger = logger.child("LagoWebhook");

/**
 * POST /api/webhook/lago
 *
 * Public endpoint that receives Lago webhook events.
 * Returns 200 OK quickly to acknowledge receipt.
 *
 * Handled event types:
 * - event.error / events.errors: Log event processing errors
 * - invoice.created: Log invoice creation
 * - invoice.generated: Log invoice finalization
 *
 * All other events are logged for debugging but not processed.
 */
export const handler = define.handlers({
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const webhookType = body?.webhook_type as string | undefined;

      webhookLogger.info("Webhook received", {
        webhookType: webhookType ?? "unknown",
        objectType: body?.object_type,
        timestamp: new Date().toISOString(),
      });

      // Log full payload at debug level
      webhookLogger.debug("Webhook payload", body);

      switch (webhookType) {
        case "event.error":
        case "events.errors": {
          const errorDetail = body?.event_error ?? body?.events_errors ?? body;
          webhookLogger.error("Lago event processing error", {
            webhookType,
            error: errorDetail,
          });
          break;
        }

        case "invoice.created": {
          const invoice = body?.invoice;
          webhookLogger.info("Invoice created", {
            lagoId: invoice?.lago_id,
            number: invoice?.number,
            customerId: invoice?.customer?.external_id,
            amountCents: invoice?.total_amount_cents,
            currency: invoice?.currency,
          });
          break;
        }

        case "invoice.generated": {
          const invoice = body?.invoice;
          webhookLogger.info("Invoice generated (finalized)", {
            lagoId: invoice?.lago_id,
            number: invoice?.number,
            customerId: invoice?.customer?.external_id,
            status: invoice?.status,
            amountCents: invoice?.total_amount_cents,
            currency: invoice?.currency,
          });
          break;
        }

        default: {
          webhookLogger.info("Unhandled webhook type", {
            webhookType: webhookType ?? "unknown",
          });
          break;
        }
      }

      // Always return 200 quickly to acknowledge receipt
      return new Response(
        JSON.stringify({ received: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      webhookLogger.error("Failed to process webhook", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Still return 200 to prevent Lago from retrying
      return new Response(
        JSON.stringify({ received: true, error: "Processing failed" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});
