import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// ── Documents ──────────────────────────────────────────────

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id"),
    filename: text("filename").notNull(),
    pageCount: integer("page_count").notNull(),
    storagePath: text("storage_path").notNull(),
    extractedText: text("extracted_text").notNull(),
    fileType: text("file_type").notNull().default("pdf"),
    keyVersion: integer("key_version").notNull().default(1),
    language: text("language"),
    contractType: text("contract_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("documents_user_id_idx").on(table.userId)],
);

// ── Analyses ───────────────────────────────────────────────

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    overallRiskScore: integer("overall_risk_score"),
    recommendation: text("recommendation"),
    topConcerns: text("top_concerns"),
    summaryText: text("summary_text"),
    parsedClauses: text("parsed_clauses"),
    responseLanguage: text("response_language").notNull().default("en"),
    displayName: text("display_name"),
    errorMessage: text("error_message"),
    isPublic: boolean("is_public").notNull().default(false),
    shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("analyses_document_id_idx").on(table.documentId)],
);

// ── Clauses ────────────────────────────────────────────────

export const clauses = pgTable(
  "clauses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    clauseText: text("clause_text").notNull(),
    startIndex: integer("start_index").notNull(),
    endIndex: integer("end_index").notNull(),
    position: integer("position").notNull(),
    riskLevel: text("risk_level").notNull(),
    explanation: text("explanation").notNull(),
    saferAlternative: text("safer_alternative"),
    category: text("category").notNull(),
    matchedPatterns: jsonb("matched_patterns").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("clauses_analysis_id_idx").on(table.analysisId)],
);

// ── Knowledge Patterns ─────────────────────────────────────

export const knowledgePatterns = pgTable(
  "knowledge_patterns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clausePattern: text("clause_pattern").notNull(),
    category: text("category").notNull(),
    contractType: jsonb("contract_type").notNull().$type<string[]>(),
    riskLevel: text("risk_level").notNull(),
    whyRisky: text("why_risky").notNull(),
    saferAlternative: text("safer_alternative").notNull(),
    jurisdictionNotes: text("jurisdiction_notes").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_patterns_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

// ── Pipeline Metrics ──────────────────────────────────────

export const pipelineMetrics = pgTable(
  "pipeline_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id").references(() => analyses.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    model: text("model"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pipeline_metrics_analysis_id_idx").on(table.analysisId),
    index("pipeline_metrics_created_at_idx").on(table.createdAt),
  ],
);

// ── Rate Limits ────────────────────────────────────────────

export const rateLimits = pgTable(
  "rate_limits",
  {
    ipAddress: text("ip_address").notNull(),
    date: date("date").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ipAddress, table.date] })],
);
