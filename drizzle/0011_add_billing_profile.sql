-- Phase P2: billing-profile extensions + EV-card issuance audit
-- Adds two columns on user_mappings (billing_tier, cards_issued) and a new
-- issued_cards table that records the Lago disposition chosen at issuance.

ALTER TABLE "user_mappings"
  ADD COLUMN "billing_tier" text NOT NULL DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE "user_mappings"
  ADD CONSTRAINT "user_mappings_billing_tier_check"
  CHECK ("billing_tier" IN ('standard', 'comped'));
--> statement-breakpoint
ALTER TABLE "user_mappings"
  ADD COLUMN "cards_issued" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE "issued_cards" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_mapping_id" integer NOT NULL REFERENCES "user_mappings"("id") ON DELETE CASCADE,
  "card_type" text NOT NULL DEFAULT 'ev_card',
  "billing_mode" text NOT NULL,
  "lago_invoice_id" text,
  "lago_applied_coupon_id" text,
  "note" text,
  "sync_error" text,
  "issued_by" text REFERENCES "users"("id"),
  "issued_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "issued_cards_billing_mode_check"
    CHECK ("billing_mode" IN ('charged', 'no_cost', 'skipped_sync')),
  CONSTRAINT "issued_cards_card_type_check"
    CHECK ("card_type" IN ('ev_card', 'keytag', 'sticker'))
);
--> statement-breakpoint
CREATE INDEX "idx_issued_cards_user_mapping_id" ON "issued_cards" ("user_mapping_id");
--> statement-breakpoint
CREATE INDEX "idx_issued_cards_issued_at" ON "issued_cards" ("issued_at");
