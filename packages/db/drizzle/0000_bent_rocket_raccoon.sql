CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"overall_risk_score" integer,
	"recommendation" text,
	"top_concerns" jsonb,
	"summary_text" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"clause_text" text NOT NULL,
	"start_index" integer NOT NULL,
	"end_index" integer NOT NULL,
	"position" integer NOT NULL,
	"risk_level" text NOT NULL,
	"explanation" text NOT NULL,
	"safer_alternative" text,
	"category" text NOT NULL,
	"matched_patterns" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"filename" text NOT NULL,
	"page_count" integer NOT NULL,
	"storage_path" text NOT NULL,
	"extracted_text" text NOT NULL,
	"language" text,
	"contract_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clause_pattern" text NOT NULL,
	"category" text NOT NULL,
	"contract_type" jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"why_risky" text NOT NULL,
	"safer_alternative" text NOT NULL,
	"jurisdiction_notes" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"ip_address" text NOT NULL,
	"date" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_ip_address_date_pk" PRIMARY KEY("ip_address","date")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_document_id_idx" ON "analyses" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "clauses_analysis_id_idx" ON "clauses" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "knowledge_patterns_embedding_idx" ON "knowledge_patterns" USING hnsw ("embedding" vector_cosine_ops);