-- Consolidated schema from Drizzle migrations 0000-0004
-- Tables: documents, analyses, clauses, knowledge_patterns, rate_limits

-- ── Documents ──────────────────────────────────────────────
CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "filename" text NOT NULL,
  "page_count" integer NOT NULL,
  "storage_path" text NOT NULL,
  "extracted_text" text NOT NULL,
  "file_type" text NOT NULL DEFAULT 'pdf',
  "key_version" integer NOT NULL DEFAULT 1,
  "language" text,
  "contract_type" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "documents_user_id_idx" ON "documents" USING btree ("user_id");

-- ── Analyses ───────────────────────────────────────────────
CREATE TABLE "analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "overall_risk_score" integer,
  "recommendation" text,
  "top_concerns" text,
  "summary_text" text,
  "parsed_clauses" text,
  "response_language" text NOT NULL DEFAULT 'en',
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "analyses_document_id_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE
);

CREATE INDEX "analyses_document_id_idx" ON "analyses" USING btree ("document_id");

-- ── Clauses ────────────────────────────────────────────────
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
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "clauses_analysis_id_analyses_id_fk"
    FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE CASCADE
);

CREATE INDEX "clauses_analysis_id_idx" ON "clauses" USING btree ("analysis_id");

-- ── Knowledge Patterns ─────────────────────────────────────
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

CREATE INDEX "knowledge_patterns_embedding_idx" ON "knowledge_patterns"
  USING hnsw ("embedding" vector_cosine_ops);

-- ── Rate Limits ────────────────────────────────────────────
CREATE TABLE "rate_limits" (
  "ip_address" text NOT NULL,
  "date" date NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "rate_limits_ip_address_date_pk" PRIMARY KEY ("ip_address", "date")
);
