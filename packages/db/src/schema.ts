import {
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

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"), // nullable — future auth
  filename: text("filename").notNull(),
  pageCount: integer("page_count").notNull(),
  storagePath: text("storage_path").notNull(),
  extractedText: text("extracted_text").notNull(),
  language: text("language"),
  contractType: text("contract_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
    topConcerns: jsonb("top_concerns").$type<string[]>(),
    summaryText: text("summary_text"),
    parsedClauses:
      jsonb("parsed_clauses").$type<
        Array<{ text: string; position: number; startIndex: number; endIndex: number }>
      >(),
    errorMessage: text("error_message"),
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
