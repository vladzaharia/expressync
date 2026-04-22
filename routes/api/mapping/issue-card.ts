/**
 * POST /api/mapping/issue-card
 *
 * Record an EV-card / token issuance on a mapping and (optionally) bill the
 * customer in Lago. The operator picks a `billing_mode`:
 *
 *   - `charged`: one-off invoice with the `ev_card` add-on. Customer pays $3.
 *   - `no_cost`: one-off invoice + `free_card` coupon. Net $0, logged.
 *   - `skipped_sync`: local audit only; no Lago call.
 *
 * Atomic DB tx: increments `user_mappings.cards_issued` and inserts
 * `issued_cards` row. Lago calls happen after commit so a Lago failure
 * doesn't lose the local audit record; any failure is recorded in
 * `issued_cards.sync_error` for retry.
 */

import { eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import { syncCustomerCardMetadata } from "../../../src/services/customer-card-metadata.service.ts";
import { isMetaTag } from "../../../src/lib/tag-hierarchy.ts";

const log = logger.child("IssueCard");

const BILLING_MODES = ["charged", "no_cost", "skipped_sync"] as const;
type BillingMode = typeof BILLING_MODES[number];

const CARD_TYPES = ["ev_card", "keytag", "sticker"] as const;
type CardType = typeof CARD_TYPES[number];

function isBillingMode(v: unknown): v is BillingMode {
  return typeof v === "string" &&
    (BILLING_MODES as readonly string[]).includes(v);
}

function isCardType(v: unknown): v is CardType {
  return typeof v === "string" &&
    (CARD_TYPES as readonly string[]).includes(v);
}

/**
 * Add-on used for the card-issuance fee ($3). Lago renamed this from `ev_card`
 * on 2026-04-22 to make room for a future $0 "registered tag" roster add-on
 * that never materialized (Lago OSS v1.45 rejects $0 add-ons and has no way
 * to append line items to subscription invoices — see the audit plan for the
 * full evidence). The roster lives in `customer.metadata` instead; this
 * add-on is reserved for the actual one-time $3 issuance fee.
 */
const NEW_CARD_ADD_ON_CODE = "new_ev_card";
const FREE_CARD_COUPON_CODE = "free_card";
const DEFAULT_CURRENCY = "USD";

/**
 * Per-type invoice display label. Rendered as the line-item heading on the
 * Lago invoice PDF (overrides the add-on's generic "New EV Card" name).
 */
const CARD_TYPE_INVOICE_DISPLAY: Record<CardType, string> = {
  ev_card: "EV Card",
  keytag: "EV Keytag",
  sticker: "EV Sticker",
};

export const handler = define.handlers({
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonError(400, "invalid_json");
    }

    const userMappingId = Number(
      (body as { userMappingId?: unknown }).userMappingId,
    );
    const billingMode = (body as { billingMode?: unknown }).billingMode;
    const cardTypeRaw = (body as { cardType?: unknown }).cardType;
    const note = (body as { note?: unknown }).note;

    if (!Number.isInteger(userMappingId) || userMappingId <= 0) {
      return jsonError(400, "invalid_user_mapping_id");
    }
    if (!isBillingMode(billingMode)) {
      return jsonError(400, "invalid_billing_mode", {
        allowed: [...BILLING_MODES],
      });
    }
    // cardType defaults to ev_card when omitted (back-compat with earlier clients).
    const cardType: CardType = cardTypeRaw === undefined
      ? "ev_card"
      : (isCardType(cardTypeRaw) ? cardTypeRaw : null as unknown as CardType);
    if (cardTypeRaw !== undefined && !isCardType(cardTypeRaw)) {
      return jsonError(400, "invalid_card_type", {
        allowed: [...CARD_TYPES],
      });
    }
    const noteStr = typeof note === "string" ? note : null;

    // Load mapping (need lagoCustomerExternalId + customer currency context).
    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, userMappingId));
    if (!mapping) {
      return jsonError(404, "mapping_not_found");
    }
    // Meta-tags (OCPP-*) are hierarchy-rollup parents — never the target of
    // a physical card. Reject outright; the UI should have disabled the
    // Issue Card button on meta-mappings.
    if (isMetaTag(mapping.steveOcppIdTag)) {
      return jsonError(400, "mapping_is_meta_tag", {
        hint:
          "Meta-tags (OCPP-*) cannot receive physical cards. Issue the card against one of this user's real child mappings.",
      });
    }
    if (
      (billingMode === "charged" || billingMode === "no_cost") &&
      !mapping.lagoCustomerExternalId
    ) {
      return jsonError(
        400,
        "mapping_missing_lago_customer",
        { hint: "Use billingMode=skipped_sync for unlinked mappings." },
      );
    }

    // Resolve actor (best-effort — auth middleware populates ctx.state if signed in).
    const issuedBy = typeof (ctx.state as { userId?: unknown })?.userId ===
        "string"
      ? ((ctx.state as { userId: string }).userId)
      : null;

    // Atomic local write first — we never lose an audit row.
    let insertedId: number;
    try {
      insertedId = await db.transaction(async (tx) => {
        await tx
          .update(schema.userMappings)
          .set({
            cardsIssued: sql`${schema.userMappings.cardsIssued} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.userMappings.id, userMappingId));
        const [row] = await tx
          .insert(schema.issuedCards)
          .values({
            userMappingId,
            cardType,
            billingMode,
            note: noteStr,
            issuedBy: issuedBy ?? undefined,
          })
          .returning({ id: schema.issuedCards.id });
        return row.id;
      });
    } catch (err) {
      log.error("DB write failed while recording issued card", {
        error: err instanceof Error ? err.message : String(err),
        userMappingId,
        billingMode,
      });
      return jsonError(500, "db_write_failed");
    }

    log.info("Issued card recorded", {
      issuedCardId: insertedId,
      userMappingId,
      billingMode,
    });

    // Lago side — only for charged / no_cost.
    let lagoInvoiceId: string | null = null;
    let lagoAppliedCouponId: string | null = null;
    let syncError: string | null = null;

    if (billingMode !== "skipped_sync") {
      const externalCustomerId = mapping.lagoCustomerExternalId!;
      // Build the fee description from the card id + OCPP tag so the invoice
      // line pinpoints exactly which physical card was issued. Operator's note
      // (if provided) is appended after the structured header.
      const structuredDescription = `Card #${insertedId} · ${mapping.steveOcppIdTag}`;
      const description = noteStr
        ? `${structuredDescription} — ${noteStr}`
        : structuredDescription;
      try {
        const { invoice } = await lagoClient.createOneOffInvoice({
          external_customer_id: externalCustomerId,
          currency: DEFAULT_CURRENCY,
          fees: [
            {
              add_on_code: NEW_CARD_ADD_ON_CODE,
              units: 1,
              description,
              invoice_display_name: CARD_TYPE_INVOICE_DISPLAY[cardType],
            },
          ],
        });
        lagoInvoiceId = invoice.lago_id;
        log.info("One-off invoice created for EV card", {
          issuedCardId: insertedId,
          lagoInvoiceId,
          cardType,
          description,
        });
      } catch (err) {
        syncError = `invoice_create_failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
        log.error("Lago one-off invoice failed", {
          issuedCardId: insertedId,
          error: syncError,
        });
      }

      if (billingMode === "no_cost" && syncError === null) {
        try {
          const { applied_coupon } = await lagoClient.createAppliedCoupon({
            external_customer_id: externalCustomerId,
            coupon_code: FREE_CARD_COUPON_CODE,
          });
          lagoAppliedCouponId = applied_coupon.lago_id;
          log.info("Free-card coupon applied", {
            issuedCardId: insertedId,
            lagoAppliedCouponId,
          });
        } catch (err) {
          syncError = `coupon_apply_failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          log.error("Lago coupon apply failed", {
            issuedCardId: insertedId,
            error: syncError,
          });
        }
      }

      // Mirror issued cards into customer metadata (display_in_invoice=true)
      // so the next invoice PDF shows them. Non-fatal on failure.
      try {
        await syncCustomerCardMetadata(externalCustomerId);
      } catch (err) {
        const metaErr = `metadata_sync_failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
        log.warn("Lago customer metadata sync failed (non-fatal)", {
          issuedCardId: insertedId,
          error: metaErr,
        });
        // Only record if no prior error — primary errors take precedence.
        if (syncError === null) syncError = metaErr;
      }
    }

    // Backfill Lago identifiers / sync_error on the audit row.
    if (lagoInvoiceId || lagoAppliedCouponId || syncError) {
      try {
        await db
          .update(schema.issuedCards)
          .set({
            lagoInvoiceId,
            lagoAppliedCouponId,
            syncError,
          })
          .where(eq(schema.issuedCards.id, insertedId));
      } catch (err) {
        log.error("Failed to backfill issued_cards Lago IDs", {
          issuedCardId: insertedId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: syncError === null,
        issuedCardId: insertedId,
        billingMode,
        lagoInvoiceId,
        lagoAppliedCouponId,
        syncError,
      }),
      {
        status: syncError === null ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});

function jsonError(
  status: number,
  code: string,
  extra?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ error: code, ...(extra ?? {}) }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
