ALTER TABLE "analyses" ALTER COLUMN "top_concerns" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "parsed_clauses" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_user_id_idx" ON "documents" USING btree ("user_id");