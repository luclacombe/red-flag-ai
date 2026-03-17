# @redflag/db

Database layer — Drizzle schema, client, migrations, and query functions (including RAG vector search).

## What's Here

- `src/schema.ts` — 6 tables: documents, analyses, clauses, knowledge_patterns, rate_limits, pipeline_metrics
- `src/client.ts` — Lazy-initialized Drizzle client (`db` proxy + `getDb()`) with `{ prepare: false }` for Supabase pooler
- `src/embeddings.ts` — Voyage AI embedding functions (`embedText`, `embedTexts`) using `voyage-law-2` model (1024 dims)
- `src/queries/findSimilarPatterns.ts` — pgvector cosine similarity search against knowledge_patterns
- `src/queries/getPatternsByContractType.ts` — **NEW (Phase 1):** Bulk fetch all patterns for a contract type. Returns `KnowledgePatternWithEmbedding[]` (includes embedding vectors for in-memory similarity). Single SQL query with jsonb `@>` containment filter.
- `src/index.ts` — Barrel export (re-exports `eq`, `sql` from `drizzle-orm`, all schema, embeddings, queries)
- `src/queries/recordPipelineMetric.ts` — Insert pipeline metrics (`recordPipelineMetric(input)` → `void`). Fire-and-forget from orchestrator/upload route.
- `drizzle.config.ts` — Drizzle Kit config (`dialect: "postgresql"`)
- `drizzle/` — Generated migration SQL files (gitignored from Biome linting)

## DB Commands

```bash
pnpm --filter @redflag/db db:generate   # Generate migration from schema changes
pnpm --filter @redflag/db db:push       # Push schema directly (dev only)
pnpm --filter @redflag/db db:migrate    # Run migrations
pnpm --filter @redflag/db db:studio     # Open Drizzle Studio
```

## Key Details

- **Driver:** `postgres` npm package, imported via `drizzle-orm/postgres-js`
- **Connection:** Supabase transaction pooler (port 6543), `{ prepare: false }` required
- **Vector column:** `knowledge_patterns.embedding` is `vector(1024)` with HNSW index using cosine distance
- **Composite PK:** `rate_limits` uses `(ip_address, date)` composite primary key
- **Cascading deletes:** `documents → analyses → clauses` cascade on delete
- **jsonb columns:** `top_concerns`, `matched_patterns`, `contract_type` — typed with `$type<string[]>()`; `parsed_clauses` typed with `$type<PositionedClause[]>()`
- **response_language:** `analyses.response_language` text NOT NULL DEFAULT 'en' — user-selected language for AI explanations
- **Share columns:** `analyses.is_public` boolean NOT NULL DEFAULT false, `analyses.share_expires_at` timestamptz nullable. Control public access to analyses. Migration: `supabase/migrations/00000000000004_share_links.sql`.

## Embedding Functions

- `embedText(text, inputType)` → `number[]` — single text embedding via Voyage AI
- `embedTexts(texts, inputType)` → `number[][]` — batch (max 128 per call)
- `inputType`: `"document"` for knowledge base entries, `"query"` for clause search
- Retries once on API error, then throws
- Requires `VOYAGE_API_KEY` env var

## Vector Search

- `findSimilarPatterns(embedding, options?)` → `SimilarPattern[]`
- Uses pgvector `<=>` cosine distance operator
- Default top-k: 5, optional `contractType` filter (jsonb `@>` containment)
- Returns `KnowledgePattern` extended with `similarity` score (0-1)

## Bulk Pattern Fetch (Phase 1)

- `getPatternsByContractType(contractType)` → `KnowledgePatternWithEmbedding[]`
- Single SQL query: `WHERE contract_type @> $1::jsonb ORDER BY category, risk_level DESC`
- Returns all patterns (~20-50) including embedding vectors for in-memory cosine similarity
- `KnowledgePatternWithEmbedding` extends `KnowledgePattern` with `embedding: number[]`
- pgvector returns embeddings as strings in raw SQL — `parseEmbedding()` handles both string and array formats

## Rules

- All schema changes require a Drizzle migration — never modify DB directly
- RAG vector search queries live here, not in `packages/agents`
- `DATABASE_URL` env var is validated at first DB access (lazy), not at import time — prevents build failures
- `VOYAGE_API_KEY` env var is validated at first embedding call, not at import time
- Drizzle operators (e.g., `eq`, `sql`) are re-exported from `src/index.ts` — import from `@redflag/db`, not `drizzle-orm`
