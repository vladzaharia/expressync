ALTER TABLE user_mappings ADD COLUMN tag_type TEXT NOT NULL DEFAULT 'other';
--> statement-breakpoint
ALTER TABLE user_mappings ADD CONSTRAINT user_mappings_tag_type_check CHECK (tag_type IN ('ev_card','keytag','sticker','phone_nfc','guest_qr','app','other'));
