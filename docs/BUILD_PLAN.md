# RedFlag AI — MVP Build Plan

> This is the execution plan for Claude Code sessions. Each phase = one focused session.
> Start each session: `"Read docs/BUILD_PLAN.md, begin Phase N"`
> End each session: quality gate passes → update checkboxes → commit

---

## Architecture Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Structure | Turborepo monorepo (pnpm) | Package isolation, shared types, clean dependency graph |
| Packages | `apps/web`, `packages/api`, `packages/agents`, `packages/db`, `packages/shared` | Agent pipeline testable without Next.js, DB layer isolated, shared Zod schemas |
| Router | Next.js 15 App Router | Server components for shell, client components for interactive analysis |
| PDF extraction | `unpdf` in Node.js runtime | ESM-native, built on pdf.js, modern |
| Streaming | tRPC SSE subscriptions (`httpSubscriptionLink`) | End-to-end type safety on streamed clause events, consistent with tRPC API layer |
| File upload | Raw Next.js route handler (POST `/api/upload`) | tRPC doesn't handle multipart/form-data natively — hybrid approach |
| RAG logic | `packages/db` as query functions | Vector search is a database query, not agent logic |
| DB schema | 5 tables: documents, analyses, clauses, knowledge_patterns, rate_limits | Nullable `user_id` FK for future auth. No stored clause embeddings for MVP |
| Pipeline model | Sequential per clause, batch embed, streamed | Batch-embed all clauses upfront (1 Voyage call), then process clause through Risk → Rewrite, yield to client, next clause. Best UX within Vercel 300s timeout. |
| Agent design | Pure async functions, no classes | Simple, testable, composable |
| Claude models | Haiku for relevance gate, Sonnet for all other agents | Gate is classification (cheap/fast). Sonnet is capable enough with RAG context. |
| Prompts | Template strings in `packages/agents/prompts/` | Co-located with agent functions, easy to iterate |
| Embeddings | Voyage AI REST API (voyage-law-2, 1024 dimensions) | Raw fetch, no SDK dependency |
| Testing | Vitest, unit + integration, no E2E | Fast, TypeScript-native, monorepo-compatible |
| Linting | Biome | Replaces ESLint + Prettier. Single tool, fast, zero-config for TS |
| UI layout | 2 routes (`/`, `/analysis/[id]`), vertical card stack | Card stack is mobile-friendly, fast to build. Future: side-by-side (clause positions stored) |
| CI/CD | GitHub Actions → Vercel auto-deploy | lint → type-check → test → build (fail-fast) |
| Vercel streaming | First SSE event within 25s, 300s max (Node.js runtime) | Emit immediate status event before heavy processing. Edge runtime incompatible with Anthropic SDK + postgres driver. |
| Concurrency control | Atomic `claimAnalysis()` + recovery path | Prevents duplicate pipeline runs from multiple SSE subscriptions. Stale `processing` analyses (>10 min) get reclaimed. |
| Connection pooling | Supabase transaction pooler (port 6543) | Vercel serverless creates new connections per invocation — must use pooler, not direct connection. |
| File validation | MIME type + magic bytes (`%PDF-`) | MIME alone is spoofable. Check first 5 bytes of uploaded file. |
| Prompt injection | System prompt framing + Zod output validation | Document text is untrusted input. Instruct Claude to ignore embedded instructions. Zod catches structural manipulation. |

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role key (server only)
ANTHROPIC_API_KEY=                # Claude API key
VOYAGE_API_KEY=                   # Voyage AI embedding API key
NEXT_PUBLIC_APP_URL=              # App URL (http://localhost:3000 in dev)
```

## End-to-End Analysis Flow

```
1. Client uploads PDF          → POST /api/upload (multipart/form-data)
2. Server validates            → file type, size, page count (≤30)
3. Server stores PDF           → Supabase Storage bucket
4. Server extracts text        → unpdf
5. Server runs relevance gate  → Claude Haiku: is this a contract?
6. If not contract             → return rejection with reason, stop
7. If contract                 → create document + analysis records (status: "pending")
8. Server returns              → { analysisId }
9. Client navigates            → /analysis/[analysisId]
10. Client subscribes          → tRPC SSE subscription
11. Server emits               → { type: "status", message: "Analyzing..." } (within 25s)
12. Server runs Parse Agent    → split into clauses with positions
13. For each clause:
    a. Embed clause            → Voyage AI API
    b. Vector search           → pgvector top-k similar patterns
    c. Risk Agent              → score + explain using clause + patterns
    d. Rewrite Agent           → safer alternative (if flagged)
    e. Persist clause to DB    → insert into clauses table
    f. Yield to client         → { type: "clause_analysis", data: ClauseAnalysis }
14. Summary Agent              → aggregate scores, recommendation
15. Persist summary            → update analysis record (status: "complete")
16. Yield summary              → { type: "summary", data: Summary }
17. Close stream

On page refresh (analysis already complete):
- tRPC query loads analysis + clauses from DB
- Renders immediately, no SSE needed
```

---

## Phase 0: Foundation

**Objective:** Scaffold the entire monorepo, wire all packages, set up Supabase, CI pipeline. Zero features — just a working skeleton that builds, lints, and type-checks.

**Entry criteria:** Empty repo, project planning complete.

### Tasks

#### 0.1 — Turborepo scaffold
- [x] Initialize Turborepo with pnpm: `pnpm dlx create-turbo@latest`
- [x] Configure pnpm workspace: `apps/*`, `packages/*`
- [x] Create package structure:
  ```
  apps/web/              → Next.js 15 (App Router)
  packages/api/          → tRPC routers, procedures, context
  packages/agents/       → Agent pipeline functions + prompts
  packages/db/           → Drizzle schema, migrations, client, queries
  packages/shared/       → Zod schemas, types, constants
  ```
- [x] Configure root `turbo.json` task pipeline:
  ```json
  {
    "tasks": {
      "lint": {},
      "type-check": {},
      "test": {},
      "build": { "dependsOn": ["^build"] },
      "dev": { "persistent": true }
    }
  }
  ```
- [x] Set up TypeScript strict mode in root `tsconfig.json` with package-level extends
- [x] Configure path aliases for cross-package imports (`@redflag/shared`, `@redflag/db`, etc.)
- [x] Create `.gitignore`: `node_modules`, `.next`, `dist`, `coverage`, `.turbo`, `.env.local`, `.env`

#### 0.2 — Biome setup
- [x] Install Biome at root: `pnpm add -D @biomejs/biome -w`
- [x] Create `biome.json` at root: TypeScript strict, consistent formatting rules
- [x] Add `lint` script to root and each package

#### 0.3 — Shared package (`packages/shared`)
- [x] Zod schemas for streamed SSE event types:
  ```typescript
  // Discriminated union for all streamed events
  StatusEvent      → { type: "status", message: string }
  ClauseEvent      → { type: "clause_analysis", data: ClauseAnalysis }
  SummaryEvent     → { type: "summary", data: Summary }
  ErrorEvent       → { type: "error", message: string, recoverable: boolean }
  ```
- [x] Zod schema for `ClauseAnalysis`:
  ```typescript
  {
    clauseText: string,
    startIndex: number,        // for future side-by-side view
    endIndex: number,          // for future side-by-side view
    position: number,          // clause order in document
    riskLevel: "red" | "yellow" | "green",
    explanation: string,
    saferAlternative: string | null,  // null for green clauses
    category: string,
    matchedPatterns: string[],  // IDs of matched knowledge base patterns
  }
  ```
- [x] Zod schema for `Summary`:
  ```typescript
  {
    overallRiskScore: number,       // 0-100
    recommendation: "sign" | "caution" | "do_not_sign",
    topConcerns: string[],
    clauseBreakdown: { red: number, yellow: number, green: number },
    language: string,               // detected document language
    contractType: string,
  }
  ```
- [x] Zod schema for `KnowledgePattern` (matches DB shape):
  ```typescript
  {
    id: string,
    clausePattern: string,
    category: string,
    contractType: string[],
    riskLevel: "red" | "yellow",
    whyRisky: string,
    saferAlternative: string,
    jurisdictionNotes: string,
  }
  ```
- [x] Zod schema for gate result:
  ```typescript
  {
    isContract: boolean,
    contractType: string | null,
    language: string | null,
    reason: string,
  }
  ```
- [x] Constants: `MAX_PAGES = 30`, `RATE_LIMIT_PER_DAY = 2`, `VOYAGE_DIMENSIONS = 1024`
- [x] Export all types and schemas

#### 0.4 — Database package (`packages/db`)
- [x] Install Drizzle ORM + `drizzle-kit` + `postgres` driver
- [x] Create Drizzle config pointing to Supabase Postgres
- [x] Define schema:
  ```
  documents
    id              uuid PK default gen_random_uuid()
    user_id         uuid nullable (FK → auth.users, for future auth)
    filename        text not null
    page_count      integer not null
    storage_path    text not null (Supabase Storage path)
    extracted_text  text not null
    language        text
    contract_type   text
    created_at      timestamptz default now()

  analyses
    id              uuid PK default gen_random_uuid()
    document_id     uuid FK → documents not null
    status          text not null default 'pending' ('pending' | 'processing' | 'complete' | 'failed')
    overall_risk_score  integer nullable (0-100)
    recommendation  text nullable ('sign' | 'caution' | 'do_not_sign')
    top_concerns    jsonb nullable (string[])
    summary_text    text nullable
    error_message   text nullable
    created_at      timestamptz default now()
    updated_at      timestamptz default now()
    completed_at    timestamptz nullable

  clauses
    id              uuid PK default gen_random_uuid()
    analysis_id     uuid FK → analyses not null
    clause_text     text not null
    start_index     integer not null
    end_index       integer not null
    position        integer not null
    risk_level      text not null ('red' | 'yellow' | 'green')
    explanation     text not null
    safer_alternative  text nullable
    category        text not null
    matched_patterns   jsonb nullable (string[] of pattern IDs)
    created_at      timestamptz default now()

  knowledge_patterns
    id              uuid PK default gen_random_uuid()
    clause_pattern  text not null
    category        text not null
    contract_type   jsonb not null (string[])
    risk_level      text not null ('red' | 'yellow')
    why_risky       text not null
    safer_alternative  text not null
    jurisdiction_notes text not null
    embedding       vector(1024) not null
    created_at      timestamptz default now()

  rate_limits
    ip_address      text PK
    date            date PK
    count           integer not null default 0
    (composite PK: ip_address + date)
  ```
- [x] Add database indexes:
  - `analyses.document_id` — FK lookup when loading analysis for a document
  - `clauses.analysis_id` — results page loads all clauses for an analysis
  - `knowledge_patterns.embedding` — IVFFlat or HNSW index for vector search performance
  - `rate_limits` composite PK already serves as the index
- [x] Create DB client (connection wrapper with env var validation)
- [x] Generate initial migration with `drizzle-kit generate`
- [x] Export schema, client, and types

#### 0.5 — Supabase setup
- [x] Create Supabase project (via **Supabase MCP** or dashboard)
- [x] Enable `vector` extension: `CREATE EXTENSION IF NOT EXISTS vector;`
- [x] Create Storage bucket: `contracts` (private, 10MB max file size)
- [x] Run Drizzle migration to create tables
- [x] Verify tables and indexes exist and vector column works
- [x] **Use Supabase transaction pooler URL** (port 6543) for the Drizzle connection — Vercel serverless requires connection pooling. Direct connections (port 5432) will exhaust the connection limit.
- [x] Create `.env.example` with all 5 env vars
- [x] Create `.env.local` with real values (gitignored)

#### 0.6 — Next.js app shell (`apps/web`)
- [x] Initialize Next.js 15 with App Router, TypeScript strict
- [x] Install Tailwind CSS v4 + `@tailwindcss/postcss`
- [x] Install shadcn/ui, initialize with default config
- [x] Create minimal layout: `app/layout.tsx` with Tailwind, fonts
- [x] Create placeholder pages: `app/page.tsx`, `app/analysis/[id]/page.tsx`
- [x] Configure `next.config.ts`: set `transpilePackages` for all internal packages (`@redflag/shared`, `@redflag/db`, `@redflag/api`, `@redflag/agents`) so Next.js can import TypeScript source directly during dev
- [x] Verify `pnpm dev` starts and renders

#### 0.7 — tRPC setup
- [x] `packages/api`: Create tRPC router, context, procedure helpers
- [x] Use **Context7 MCP** for latest tRPC v11 + Next.js App Router integration docs
- [x] Create tRPC route handler in `apps/web/app/api/trpc/[trpc]/route.ts`
- [x] Configure client-side tRPC with `httpBatchStreamLink` + `httpSubscriptionLink`
- [x] Create a health-check procedure to verify the setup works
- [x] Wire `apps/web` to import from `@redflag/api`

#### 0.8 — CI pipeline
- [x] Create `.github/workflows/ci.yml`:
  ```yaml
  on: [push, pull_request]
  jobs:
    ci:
      runs-on: ubuntu-latest
      steps:
        - checkout
        - setup pnpm + node
        - pnpm install --frozen-lockfile
        - pnpm turbo lint type-check test build
  ```
- [x] Add `.claudeignore`: `node_modules`, `.next`, `dist`, `coverage`, `.turbo`

#### 0.9 — Vitest setup
- [x] Install Vitest at root
- [x] Configure in each package that needs tests (`packages/shared`, `packages/db`, `packages/agents`, `packages/api`)
- [x] Write one smoke test per package to verify setup
- [x] Verify `pnpm turbo test` runs all tests

### MCP Usage
- **Context7**: tRPC v11 App Router setup, Drizzle schema syntax, Supabase client config, Next.js 15 App Router patterns, Tailwind v4
- **Supabase MCP**: Create project, enable extensions, create storage bucket, verify tables

### Quality Gate
```bash
pnpm turbo lint type-check test build
# All 4 must pass. CI workflow must also pass on push.
```

### Exit Criteria
- [x] All 5 packages exist with correct `tsconfig.json` and `package.json`
- [x] Cross-package imports work (`@redflag/shared`, `@redflag/db`, `@redflag/api`)
- [x] Drizzle schema compiles, migration generated
- [x] Supabase project exists with tables, vector extension, storage bucket
- [x] tRPC health-check works from the Next.js app
- [x] `pnpm turbo lint type-check test build` passes
- [x] GitHub Actions CI passes on push
- [x] Next.js dev server starts and renders placeholder pages
- [x] Commit: `feat: scaffold turborepo monorepo with all packages and infrastructure`

---

## Phase 1: Upload + Extraction + Relevance Gate

**Objective:** Accept a PDF upload, extract text, and determine if it's a contract. The first real user-facing feature. No analysis yet — just the input pipeline.

**Entry criteria:** Phase 0 complete. All packages build. Supabase tables exist.

### Tasks

#### 1.1 — PDF upload route
- [x] Create `apps/web/app/api/upload/route.ts` (POST handler)
- [x] Accept `multipart/form-data` with a single PDF file
- [x] Validate:
  - File type is `application/pdf` (MIME type check)
  - Magic bytes: first 5 bytes are `%PDF-` (prevents spoofed MIME type uploads)
  - File size ≤ 10MB
  - Return clear error messages for each validation failure
- [x] Install `unpdf` in `apps/web`
- [x] Extract text using `unpdf` (`getDocumentProxy` + `extractText`)
- [x] Use **Context7 MCP** if `unpdf` API is unclear
- [x] Validate post-extraction:
  - Page count ≤ 30 (reject if over, with message)
  - Text is not empty (detect scanned/image PDFs)
  - Minimum text length threshold (reject near-empty documents)
- [x] Upload original PDF to Supabase Storage (`contracts` bucket)
- [x] Create `documents` record in DB (filename, page_count, storage_path, extracted_text)
- [x] Return `{ documentId }` on success, `{ error }` on failure

#### 1.2 — Relevance gate agent
- [x] Create `packages/agents/src/gate.ts`
- [x] Create `packages/agents/src/prompts/gate.ts` — system prompt for classification
- [x] Install `@anthropic-ai/sdk` in `packages/agents`
- [x] Use **Context7 MCP** for latest Anthropic SDK usage
- [x] Implement `relevanceGate(text: string)` → `GateResult`:
  - Call Claude Haiku with extracted text (truncated to first ~2000 chars for speed)
  - Return: `{ isContract, contractType, language, reason }`
  - Validate response against Zod schema from `@redflag/shared`
  - On API error: retry once, then return clear error
  - On malformed response: retry once, then return rejection with reason
- [x] Create shared Anthropic client factory in `packages/agents/src/client.ts`

#### 1.3 — Wire gate into upload route
- [x] After text extraction, call `relevanceGate(extractedText)`
- [x] If not a contract:
  - Do NOT create analysis record
  - Return `{ isContract: false, reason: "..." }` — client shows the rejection message
- [x] If contract:
  - Update document record with `language` and `contract_type`
  - Create `analyses` record (status: `pending`)
  - Return `{ isContract: true, analysisId, contractType, language }`

#### 1.4 — Tests
- [x] Unit test: `unpdf` text extraction with a sample PDF (use a small test fixture PDF in `packages/agents/src/__tests__/fixtures/`)
- [x] Unit test: gate agent with mocked Claude responses:
  - Contract input → returns `isContract: true` with type
  - Non-contract input → returns `isContract: false` with reason
  - Malformed Claude response → retries, then returns error
- [x] Unit test: upload validation (file type, size, page count, empty text)
- [x] Integration test: upload route end-to-end with mocked Supabase + mocked Claude

### MCP Usage
- **Context7**: `unpdf` API, Anthropic SDK (messages API, haiku model ID), Supabase Storage upload API
- **Supabase MCP**: Verify file appears in storage bucket after upload

### Quality Gate
```bash
pnpm turbo lint type-check test build
```

### Exit Criteria
- [x] Can upload a real PDF via POST `/api/upload`
- [x] PDF stored in Supabase Storage, document record created
- [x] Text extraction works on text-based PDFs
- [x] Scanned/image PDFs detected and rejected with clear message
- [x] Relevance gate correctly classifies contracts vs. non-contracts
- [x] Non-contracts rejected with helpful reason
- [x] Contracts create analysis record, return `analysisId`
- [x] All tests pass
- [x] Quality gate passes
- [x] Commit: `feat: pdf upload, text extraction, and contract relevance gate`

---

## Phase 2: Knowledge Base + RAG

**Objective:** Curate predatory clause patterns, embed them, store in pgvector, and build the vector search query. The foundation for intelligent analysis.

**Entry criteria:** Phase 1 complete. Upload + gate working.

### Tasks

#### 2.1 — Curate knowledge base patterns
- [x] Create `data/knowledge-base/` directory for raw pattern files
- [x] Use Claude (separate session) to generate patterns from public legal sources listed in PROJECT.md
- [x] Target: 100-150 patterns across all 5 contract types:
  - Residential lease: ~40 patterns (high priority)
  - Freelance/contractor: ~35 patterns (high priority)
  - NDA: ~25 patterns (medium priority)
  - Employment contract: ~25 patterns (medium priority)
  - Terms of Service: ~25 patterns (low priority)
- [x] Store as JSON files per contract type: `data/knowledge-base/lease.json`, etc.
- [x] Each entry must pass the quality rubric (see PROJECT.md):
  1. Grounded in real law/regulation
  2. Clear to a non-lawyer
  3. Actionable alternative (not generic)
  4. Correctly categorized
- [x] Validate all entries against `KnowledgePattern` Zod schema from `@redflag/shared`

#### 2.2 — Voyage AI embedding integration
- [x] Create `packages/db/src/embeddings.ts`
- [x] Implement `embedText(text: string)` → `number[]` (1024 dimensions):
  - POST to `https://api.voyageai.com/v1/embeddings`
  - Model: `voyage-law-2`
  - Input type: `"document"` for knowledge base entries, `"query"` for clause search
  - Handle API errors: retry once, then throw
- [x] Implement `embedTexts(texts: string[])` → `number[][]` (batch embedding)
  - Voyage API supports batch embedding (up to 128 texts per call)
  - Use for seed script efficiency

#### 2.3 — Seed script
- [x] Create `scripts/seed-knowledge-base.ts`
- [x] Reads all JSON files from `data/knowledge-base/`
- [x] Validates each entry against Zod schema
- [x] Batch embeds all `clause_pattern` fields via Voyage AI
- [x] Inserts into `knowledge_patterns` table with embeddings
- [x] Idempotent: clears existing patterns before seeding (safe to re-run)
- [x] Logs progress: `"Seeding 142 patterns... Embedding batch 1/3... Done."`
- [x] Install `tsx` as a dev dependency at root: `pnpm add -D tsx -w`
- [x] Add script to `package.json`: `"seed": "tsx scripts/seed-knowledge-base.ts"`

#### 2.4 — Vector search query
- [x] Create `packages/db/src/queries/findSimilarPatterns.ts`
- [x] Implement `findSimilarPatterns(embedding: number[], options?)` → `KnowledgePattern[]`:
  - Cosine similarity search using pgvector `<=>` operator
  - Default top-k: 5
  - Optional filter by `contract_type`
  - Returns patterns with similarity score
- [x] Use Drizzle's `sql` template for the vector query

#### 2.5 — Tests
- [x] Unit test: Zod validation of knowledge base entries (valid + invalid fixtures)
- [x] Unit test: `embedText` with mocked Voyage API response
- [x] Unit test: `findSimilarPatterns` with mocked DB (verify correct SQL generation)
- [x] Integration test: seed script → embed → search round-trip (requires real Voyage API key — skip in CI, run locally)
- [x] Verify: seed the DB, then search for "landlord can enter without notice" — should return relevant entry rights patterns

### MCP Usage
- **Context7**: Voyage AI API docs, Drizzle raw SQL syntax, pgvector operators
- **Supabase MCP**: Verify patterns inserted correctly, test vector queries directly

### Quality Gate
```bash
pnpm turbo lint type-check test build
pnpm run seed  # verify seed script works (local only, needs API keys)
```

### Exit Criteria
- [x] 100-150 curated patterns in JSON files, all passing quality rubric
- [x] Seed script embeds and inserts all patterns into Supabase
- [x] Vector search returns semantically relevant results
- [x] Search for a predatory clause returns matching patterns from the knowledge base
- [x] All tests pass
- [x] Quality gate passes
- [x] Commit: `feat: knowledge base curation, embedding pipeline, and vector search`

---

## Phase 3: Agent Pipeline + Streaming

**Objective:** Build the full analysis pipeline — all agents, the orchestrator, and tRPC SSE streaming. The core product capability.

**Entry criteria:** Phase 2 complete. Knowledge base seeded. Vector search working.

### Tasks

#### 3.1 — Parse Agent
- [x] Create `packages/agents/src/parse.ts`
- [x] Create `packages/agents/prompts/parse.ts`
- [x] Implement `parseClauses(text: string, contractType: string)` → `ParsedClause[]`:
  ```typescript
  { text: string, startIndex: number, endIndex: number, position: number }
  ```
- [x] Claude Sonnet call: identify and split contract into individual clauses
- [x] Prompt must instruct Claude to return exact clause text (verbatim from document) — do NOT ask Claude for character positions
- [x] **Compute positions in code:** Use `text.indexOf(clauseText)` to find `startIndex`, derive `endIndex` from `startIndex + clauseText.length`. LLMs cannot count characters reliably.
- [x] Validate output against Zod schema
- [x] Handle edge cases: single-clause documents, preambles, signature blocks (skip non-clause content)

#### 3.2 — Risk Agent
- [x] Create `packages/agents/src/risk.ts`
- [x] Create `packages/agents/prompts/risk.ts`
- [x] Implement `analyzeClause(clause: PositionedClause, patterns: SimilarPattern[], language: string)` → `RiskAnalysisResult`:
  - Orchestrator handles embedding + `findSimilarPatterns()` — risk agent receives pre-retrieved patterns
  - Call Claude Sonnet with: clause text + retrieved patterns as context
  - Return: risk level, explanation, category (matchedPatterns computed programmatically by orchestrator)
  - Prompt instructs Claude to respond in the document's language
  - **Prompt injection defense:** System prompt frames document text as untrusted user input
- [x] Validate output against internal `RiskAnalysisResultSchema`

#### 3.3 — Rewrite Agent
- [x] Create `packages/agents/src/rewrite.ts`
- [x] Create `packages/agents/prompts/rewrite.ts`
- [x] Implement `rewriteClause(clauseText, riskLevel, explanation, language)` → `string`:
  - Only runs for `red` and `yellow` clauses (orchestrator handles skip logic)
  - Claude Sonnet call: generate safer alternative language
  - Prompt instructs: keep the same legal intent, make it fairer
  - Responds in the document's language
- [x] Validate output against internal `RewriteResponseSchema`

#### 3.4 — Summary Agent
- [x] Create `packages/agents/src/summary.ts`
- [x] Create `packages/agents/prompts/summary.ts`
- [x] Implement `summarize(analyses, contractType, language)` → `Omit<Summary, "clauseBreakdown">`:
  - Claude Sonnet call: aggregate all clause analyses
  - Return: overall risk score (0-100), recommendation, top concerns
  - `clauseBreakdown` computed deterministically by orchestrator
  - Responds in the document's language
- [x] Validate output against internal `SummaryResponseSchema`

#### 3.5 — Pipeline orchestrator
- [x] Create `packages/agents/src/orchestrator.ts`
- [x] Implement `analyzeContract(text, contractType, language)` as an async generator:
  ```typescript
  async function* analyzeContract(params): AsyncGenerator<StreamEvent> {
    yield { type: "status", message: "Parsing contract..." }

    const clauses = await parseClauses(params.text, params.contractType)
    // Compute startIndex/endIndex via text.indexOf() — don't trust LLM positions
    const clausesWithPositions = computeClausePositions(params.text, clauses)

    yield { type: "status", message: `Found ${clauses.length} clauses. Analyzing...` }

    // Batch-embed all clause texts in one Voyage API call (up to 128 per batch)
    const embeddings = await embedTexts(clauses.map(c => c.text))

    const analyses: ClauseAnalysis[] = []
    for (let i = 0; i < clauses.length; i++) {
      const clause = clausesWithPositions[i]
      const patterns = await findSimilarPatterns(embeddings[i])

      // Run Risk + Rewrite concurrently to stay within 300s timeout
      const analysis = await analyzeClause(clause, patterns)
      const rewrite = analysis.riskLevel !== "green"
        ? await rewriteClause(clause, analysis)
        : null
      const fullAnalysis = { ...analysis, saferAlternative: rewrite }
      analyses.push(fullAnalysis)

      // Persist to DB (enables recovery on reconnect)
      await insertClause(analysisId, fullAnalysis)

      // Stream to client
      yield { type: "clause_analysis", data: fullAnalysis }
    }

    yield { type: "status", message: "Generating summary..." }
    const summary = await summarize(analyses, params.contractType)
    yield { type: "summary", data: summary }
  }
  ```
- [x] **Batch embeddings:** Embed all clause texts in a single Voyage API call instead of one call per clause. Chunks into batches of 128 for large contracts.
- [x] **Compute positions in code:** `computeClausePositions()` uses `text.indexOf(clauseText)` with forward-searching offset — never trust LLM character counting.
- [x] Error handling at each step:
  - Claude API error → retry once (built into each agent), then yield error event
  - Voyage AI down → skip RAG, run Risk Agent without patterns, note degraded confidence
  - Malformed response → retry once, then yield partial result with warning
  - Update analysis status to `failed` if unrecoverable error

#### 3.6 — tRPC SSE subscription
- [x] Use **Context7 MCP** for tRPC SSE subscription setup in App Router
- [x] Create `packages/api/src/routers/analysis.ts`
- [x] Add subscription procedure `analysis.stream`:
  ```typescript
  stream: publicProcedure
    .input(z.object({ analysisId: z.string().uuid() }))
    .subscription(async function* ({ input }) {
      const analysis = await getAnalysis(input.analysisId)

      if (analysis.status === 'complete') {
        // Load from DB, yield all results at once
        const clauses = await getClausesByAnalysis(input.analysisId)
        for (const clause of clauses) {
          yield { type: "clause_analysis", data: clause }
        }
        yield { type: "summary", data: analysis.summary }
        return
      }

      if (analysis.status === 'processing') {
        // Recovery: yield already-persisted clauses from DB
        const existingClauses = await getClausesByAnalysis(input.analysisId)
        for (const clause of existingClauses) {
          yield { type: "clause_analysis", data: clause }
        }
        // Check staleness: if processing for >10 min, reset to pending
        const stale = Date.now() - analysis.updatedAt.getTime() > 10 * 60 * 1000
        if (!stale) {
          yield { type: "status", message: "Analysis in progress on another connection..." }
          return // Don't duplicate — another consumer is running
        }
        // Fall through to re-run pipeline for stale analyses
      }

      // Atomic status transition: prevents duplicate pipeline runs
      // UPDATE ... WHERE status IN ('pending', stale 'processing') RETURNING *
      const claimed = await claimAnalysis(input.analysisId)
      if (!claimed) {
        yield { type: "status", message: "Analysis already in progress." }
        return
      }

      for await (const event of analyzeContract(analysis)) {
        yield event
      }
    })
  ```
- [x] **Implement `claimAnalysis()`:** Atomic `UPDATE analyses SET status = 'processing', updated_at = now() WHERE id = ? AND (status = 'pending' OR stale 'processing') RETURNING *`. Returns null if already claimed.
- [x] **`updated_at` column** already exists on analyses table
- [x] Add query procedure `analysis.get` — fetch analysis + clauses from DB (for completed analyses)
- [x] `httpSubscriptionLink` already configured on the client (Phase 1 setup)

#### 3.7 — Tests
- [x] Unit test per agent: mock Claude responses, verify output schema (parse: 6, risk: 6, rewrite: 5, summary: 6)
- [x] Unit test: orchestrator with all agents mocked — verify event sequence:
  ```
  status → status → clause_analysis (×N) → status → summary
  ```
- [x] Unit test: orchestrator error paths — Claude failure, Voyage failure, malformed response (10 tests)
- [x] Unit test: `claimAnalysis()` — verify atomic behavior (second call returns null via tRPC caller)
- [x] Unit test: recovery path — `processing` status yields existing clauses from DB
- [x] Unit test: `computeClausePositions()` — verify positions match `indexOf()` results (6 tests)
- [x] Integration test: full pipeline with mocked LLM — subscribe to tRPC subscription, verify all events received in order
- [x] Verify: Zod validation catches malformed agent outputs (tested in each agent's test suite)

### MCP Usage
- **Context7**: Anthropic SDK (streaming, Sonnet model ID), tRPC SSE subscriptions, Drizzle insert/update syntax
- **Supabase MCP**: Verify clauses and analysis records persist correctly during pipeline run

### Quality Gate
```bash
pnpm turbo lint type-check test build
```

### Exit Criteria
- [x] All 4 agents work individually with correct output schemas
- [x] Orchestrator chains agents sequentially per clause, yields typed events
- [x] Batch embedding works (single Voyage call for all clauses)
- [x] Clause positions computed via `indexOf()`, not LLM output
- [x] tRPC SSE subscription streams events to the client
- [x] Immediate status event emitted (Vercel 25s constraint)
- [x] Atomic `claimAnalysis()` prevents duplicate pipeline runs
- [x] Recovery path: reconnecting to `processing` analysis yields persisted clauses
- [x] Completed analyses load from DB without SSE
- [x] Error handling works at every pipeline step (retry, degrade, surface)
- [x] Prompt injection defense present in all agent system prompts
- [x] Results persist to DB as pipeline progresses
- [x] All tests pass (118 total: shared 6, db 44, agents 49, api 9, web 10)
- [x] Quality gate passes
- [x] Commit: `feat: full agent pipeline with tRPC SSE streaming`

---

## Phase 4: UI — Landing + Upload

**Objective:** Design direction, shared components, landing page, and upload flow. The first half of the UI — everything before the results page.

**Entry criteria:** Phase 3 complete. Pipeline streams events. tRPC subscription works.

**UI Spec:** Read `docs/UI_SPEC.md` + `design-system/redflag-ai/MASTER.md` + `design-system/redflag-ai/pages/landing.md` before starting. These define the design direction, component inventory, and 21st.dev source URLs. The spec is guidance — use the tools (UI/UX Pro Max skill, Magic MCP, WebFetch) during implementation and update the spec files if you deviate.

### Tasks

#### 4.1 — Design direction + theme setup
- [x] Read `design-system/redflag-ai/MASTER.md` — design direction is already defined (Bold + Warm, Flat Design, hybrid dark/light)
- [x] Use **UI/UX Pro Max skill** to validate and supplement decisions as needed:
  - Run `--domain ux` for specific UX questions that arise
  - Run `--domain style` if something feels off visually
  - Update `MASTER.md` if you change any design tokens
- [x] Configure Tailwind theme with design tokens from `MASTER.md` (colors, fonts, spacing)
- [x] Install fonts via `next/font/google`: Space Grotesk (headings) + DM Sans (body)
- [x] Install `motion` in `apps/web` (needed for BackgroundPaths + TextShimmer)

#### 4.2 — Layout + shared components
- [x] App layout: dark nav bar (`slate-900`, logo text "RedFlag AI" in Space Grotesk 600), footer with legal disclaimer
- [x] **Fetch 21st.dev component code via WebFetch** for components listed in `docs/UI_SPEC.md` § "21st.dev Component References". Do NOT guess the code — fetch from the URLs, then adapt.
- [x] Build shared components (see `docs/UI_SPEC.md` § "Components Inventory" for full specs):
  - `RiskBadge` — adapt from 21st.dev `arihantcodes/status-badge` (URL in UI_SPEC). Lucide icon + colored pill, 3 risk variants.
  - `RiskScore` — adapt from 21st.dev `magicui/animated-circular-progress-bar` (URL in UI_SPEC). SVG gauge, CSS animated count-up, color by score range.
  - `ClauseSkeleton` — pulse animation matching clause card shape (custom, CSS only)
  - `ErrorState` — friendly error display with retry option (custom)
  - `LegalDisclaimer` — footer text, not dismissable (custom)
  - `ProcessingLoader` — adapt dots variant from 21st.dev `erikx/loader` (URL in UI_SPEC). Pure CSS.
- [x] Install shadcn/ui primitives: `npx shadcn@latest add badge button card collapsible separator skeleton`

#### 4.3 — Landing page (`/`)
- [x] Read `design-system/redflag-ai/pages/landing.md` for layout and section order
- [x] Hero section (dark bg, `slate-900`):
  - `BackgroundPaths` component: **fetch from URL** in UI_SPEC, then modify (thicker strokes, risk colors, fewer paths). See modification notes in UI_SPEC.
  - Bold headline (Space Grotesk 700): clear value prop
  - Subheadline (DM Sans, `slate-300`): one sentence explanation. Optionally wrap in `TextShimmer` (fetch from URL in UI_SPEC).
  - CTA button (`amber-500`): anchors to upload section
- [x] Upload zone below hero (light bg, `slate-50`):
  - **Native HTML5 drag-and-drop** + `<input type="file" accept=".pdf">` — no `react-dropzone` dependency
  - File type validation (PDF only) with clear feedback
  - Upload progress bar
  - States: idle, drag-over (amber border), uploading, processing (ProcessingLoader + "Checking document..."), error, rejection
- [x] How it works section (3 steps, Lucide icons, numbered). Horizontal on desktop, vertical on mobile.
- [x] Legal disclaimer in footer
- [x] Mobile-first, responsive (375px base, scale up)

#### 4.4 — Upload flow + navigation
- [x] On file drop/select:
  1. Show filename + size, progress bar fills
  2. POST to `/api/upload`
  3. ProcessingLoader with "Checking document..." during gate check
  4. Handle responses:
     - Success (is contract) → navigate to `/analysis/[analysisId]`
     - Rejection (not contract) → show inline message with reason (red text, AlertCircle icon)
     - Error → show error state with retry
- [x] Rate limit check before upload (optional: pre-check via tRPC query, or handle 429 response)

### MCP Usage
- **UI/UX Pro Max skill**: Validate design decisions, run `--domain ux`/`--domain style` for specific questions. Script: `.claude/skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/scripts/search.py`
- **21st.dev Magic MCP**: Search for additional component inspiration via `mcp__magic__21st_magic_component_inspiration`. Fetch specific component code via WebFetch on 21st.dev URLs.
- **Context7**: shadcn/ui component API, Tailwind v4 utility classes, Next.js App Router navigation, `motion` library API

### Quality Gate
```bash
pnpm turbo lint type-check test build
```

### Exit Criteria
- [x] Landing page looks professional and explains the product in 5 seconds
- [x] Upload flow works: drop PDF → upload completes → navigates to results page
- [x] Error states displayed for: wrong file type, too large, scanned PDF, not a contract
- [x] Mobile responsive (tested at 375px and 768px widths)
- [x] Legal disclaimer visible
- [x] Quality gate passes
- [ ] Commit: `feat: landing page with upload flow and shared UI components`

---

## Phase 5: UI — Results + Polish

**Objective:** Streaming results page, all UI states, and visual QA. The second half of the UI.

**Entry criteria:** Phase 4 complete. Landing page and upload flow working.

**UI Spec:** Read `docs/UI_SPEC.md` + `design-system/redflag-ai/MASTER.md` + `design-system/redflag-ai/pages/analysis.md` before starting. These define the streaming UX, clause card anatomy, summary panel spec, and all page states. The spec is guidance — use the tools and update the spec files if you deviate.

### Tasks

#### 5.1 — Results page (`/analysis/[id]`)
- [x] Read `design-system/redflag-ai/pages/analysis.md` for full layout and state specs
- [x] Page logic (dual path):
  - Fetch analysis status via tRPC query
  - If `pending` or `processing` → subscribe to SSE, show streaming UI
  - If `complete` → load clauses + summary from DB, render immediately (no animation)
  - If `failed` → show error state with message
  - If not found → 404 page
- [x] Streaming UI:
  - `StatusBar` at top: `TextShimmer`-wrapped status text (fetch component from URL in UI_SPEC). Blue bg (`blue-50`), shows current pipeline step.
  - Clause cards appear one at a time with CSS fade-in + slide-up (200ms ease-out, 30ms stagger)
  - 2-3 `ClauseSkeleton` cards visible below last real card (pulse animation matching card shape)
  - `SummaryPanel` appears last after all clauses
- [x] `ClauseCard` component (see `analysis.md` for full anatomy):
  - 4px left border in risk color (`border-l-red-600` / `border-l-amber-600` / `border-l-green-600`)
  - Category tag (`text-xs uppercase tracking-wide`)
  - `RiskBadge` (built in Phase 4)
  - Clause text (`text-sm font-mono` — monospace to look like contract text). Collapsible if > 3 lines.
  - Explanation paragraph
  - Safer alternative: collapsible section (shadcn `Collapsible`), green-tinted bg when expanded, chevron toggle. Only for red/yellow clauses.
- [x] `SummaryPanel` component:
  - `RiskScore` gauge (built in Phase 4) — animated count-up on appearance
  - `RecommendationBadge`: large pill — "Safe to Sign" (green) / "Proceed with Caution" (amber) / "Do Not Sign" (red)
  - `BreakdownBar`: horizontal stacked bar (red | yellow | green segments) with counts
  - Top concerns: bulleted list
  - Contract type + language detected
- [x] Legal disclaimer: persistent text at bottom of results

#### 5.2 — States and edge cases
- [x] See `analysis.md` § "Page States" for all 5 states with full specs
- [x] Loading/streaming state: `StatusBar` + skeleton cards
- [x] All green state: positive summary message, "Safe to Sign", green gauge, still show all clause cards
- [x] Error state: show any persisted clauses + error message with what failed
- [ ] Rate limit exceeded state: friendly message + reset time
- [x] 404 state: simple centered "Analysis not found" + home link

#### 5.3 — Visual QA
- [x] Use **Playwright MCP** to screenshot each page/state (see `docs/UI_SPEC.md` § "Visual QA Plan" for the full list of 10 screenshots)
- [x] Review each screenshot against `MASTER.md` § "Pre-Delivery Checklist"
- [x] Use **UI/UX Pro Max skill** `--domain ux` to validate any UX decisions that feel uncertain
- [x] Fix any visual issues found
- [x] Iterate on spacing, colors, typography until polished

#### 5.4 — Tests
- [x] No component unit tests for MVP (visual QA via Playwright screenshots is sufficient)
- [ ] Verify tRPC client correctly subscribes and receives events
- [ ] Manual test: full end-to-end flow with a real PDF

### MCP Usage
- **UI/UX Pro Max skill**: Run `--domain ux` for UX validation, pre-delivery checklist from MASTER.md. Script: `.claude/skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/scripts/search.py`
- **21st.dev Magic MCP**: Search for additional component inspiration. Fetch code via WebFetch from URLs in UI_SPEC — do NOT guess component code.
- **Playwright MCP**: Screenshot every page state for visual QA (10 screenshots defined in UI_SPEC)
- **Context7**: shadcn/ui component API, Tailwind v4 utility classes, `motion` library API

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Visual QA: all Playwright screenshots reviewed and approved
```

### Exit Criteria
- [x] Clause cards render correctly with risk colors, explanations, alternatives
- [x] Summary panel displays overall score and recommendation
- [x] All states handled (loading, streaming, complete, error, rate limit, 404, all-green)
- [x] Mobile responsive (tested at 375px and 768px widths)
- [x] Legal disclaimer visible and unavoidable on results page
- [x] Playwright screenshots look polished on desktop and mobile
- [x] Quality gate passes
- [ ] Commit: `feat: streaming results page with clause cards and summary panel`

---

## Phase 6: Hardening + Deploy

**Objective:** Rate limiting, structured logging, Vercel deployment, README, final polish. Ship it.

**Entry criteria:** Phase 5 complete. Full user flow works locally.

### Tasks

#### 6.1 — Rate limiting
- [ ] Create rate limit middleware/helper in `packages/api/src/rateLimit.ts`
- [ ] On analysis trigger (in upload route):
  1. Extract IP from request headers (`x-forwarded-for` on Vercel — Vercel overwrites client-spoofed values)
  2. Query `rate_limits` table for (ip, today's date)
  3. If count ≥ 2: reject with 429 + clear message
  4. If under limit: increment count
- [ ] Upsert pattern: insert on first use, increment on subsequent
- [ ] Rate limit response includes reset time (midnight UTC)

#### 6.2 — Structured logging
- [ ] Create logger utility in `packages/shared/src/logger.ts`
- [ ] JSON-structured logs with fields: `timestamp`, `level`, `message`, `metadata`
- [ ] Log at pipeline boundaries:
  - Upload received: `{ filename, pageCount, fileSize }`
  - Gate result: `{ isContract, contractType, durationMs }`
  - Clause analyzed: `{ position, riskLevel, ragPatternsFound, durationMs }`
  - Pipeline complete: `{ totalClauses, totalDurationMs, overallScore }`
  - Errors: `{ step, error, retried }`
- [ ] Use `console.log` with JSON.stringify (Vercel captures structured logs natively)

#### 6.3 — Edge cases + error handling audit
- [ ] Walk through every error scenario in PROJECT.md's Error Handling table
- [ ] Verify each one works:
  - Scanned PDF → clear rejection message
  - Spoofed file type → rejected by magic byte check
  - PDF extraction failure → user-friendly error
  - Claude API timeout → retry once, then error state
  - Voyage AI down → graceful degradation (RAG skipped)
  - Malformed Claude response → retry, then partial results
  - Prompt injection in document → Claude ignores, Zod validates output
  - Over 30 pages → reject at upload
  - Empty document → reject post-extraction
  - Concurrent SSE subscriptions → atomic claim prevents duplicates
- [ ] Fix any gaps found

#### 6.4 — Vercel deployment
- [ ] Use **Vercel MCP** to configure:
  - Link repo to Vercel project
  - Set environment variables (all 5 from .env.example)
  - Configure build settings: `pnpm turbo build`, output dir `apps/web/.next`
  - Root directory: `apps/web` (or configure Turborepo root build)
- [ ] Streaming route runtime:
  - Use **Node.js runtime** (not Edge) — `@anthropic-ai/sdk` and `postgres` driver are not Edge-compatible
  - Set `maxDuration` in route config to extend timeout (Pro plan: up to 300s)
  - If on Hobby plan (10s limit): consider chunked processing or upgrading
- [ ] Deploy to Vercel
- [ ] Verify live URL works end-to-end
- [ ] Test with real Claude + Voyage API on deployed version
- [ ] Check Vercel function logs for errors

#### 6.5 — Domain setup
- [ ] Connect `red-flag-ai.com` domain via **Vercel MCP** or dashboard
- [ ] Verify HTTPS + domain propagation

#### 6.6 — GitHub Actions CI finalization
- [ ] Verify CI workflow runs on push and PR
- [ ] Add CI status badge to README
- [ ] Ensure all CI steps pass on the `main` branch

#### 6.7 — README
- [ ] Project title + one-line description
- [ ] Live demo URL
- [ ] CI badge
- [ ] Architecture diagram (Mermaid):
  ```
  Upload → Gate → Parse → Risk+RAG → Rewrite → Summary → Stream to UI
  ```
- [ ] Tech stack table (from PROJECT.md)
- [ ] Screenshots or demo GIF (use Playwright to capture, or record manually)
- [ ] Local setup instructions (clone, pnpm install, env vars, seed, dev)
- [ ] What I'd improve with more time (shows self-awareness — per RESEARCH.md)
- [ ] Cost awareness note: approximate cost per analysis (~$0.10-0.20) and how rate limiting controls spend
- [ ] Legal disclaimer note

#### 6.8 — Final smoke test
- [ ] Upload a residential lease → verify full analysis streams correctly
- [ ] Upload a freelance contract → verify different patterns are retrieved
- [ ] Upload a non-contract (e.g., a recipe PDF) → verify rejection
- [ ] Upload a scanned PDF → verify rejection
- [ ] Upload a spoofed file (non-PDF renamed to .pdf) → verify rejection
- [ ] Hit rate limit → verify friendly message
- [ ] Open two tabs for same analysis → verify no duplicate pipeline run
- [ ] Test on mobile (responsive)
- [ ] Check Vercel logs — no unhandled errors

### MCP Usage
- **Vercel MCP**: Deployment, env vars, domain, build logs
- **Playwright MCP**: Capture screenshots/GIF for README
- **Supabase MCP**: Verify production data looks correct after smoke tests

### Quality Gate
```bash
pnpm turbo lint type-check test build
# All CI checks green
# Live URL functional
# README complete
```

### Exit Criteria
- [ ] Rate limiting works (2/day per IP)
- [ ] Structured logs capture pipeline metrics
- [ ] All error scenarios handled gracefully (including new: spoofed files, prompt injection, concurrent SSE)
- [ ] Deployed on Vercel with live URL
- [ ] Domain configured (red-flag-ai.com)
- [ ] CI badge green on README
- [ ] README has architecture diagram, screenshots, setup instructions, cost note
- [ ] Smoke tests pass on production
- [ ] Mobile responsive on deployed version
- [ ] Commit: `feat: rate limiting, logging, deployment, and README`
- [ ] **MVP COMPLETE**

---

## Session Protocol

### Starting a phase
```
Read docs/BUILD_PLAN.md, begin Phase N
```

### During a phase
- Work through tasks in order
- Use specified MCPs when hitting unfamiliar APIs
- Run quality gate commands frequently — don't accumulate debt
- If blocked, note the blocker and move to the next task if independent

### Before finishing a phase
Verify all of these before committing:
- [ ] All completed tasks checked off in this file
- [ ] CLAUDE.md updated in every package you modified (what exists, not what's planned)
- [ ] Root CLAUDE.md updated if you added deps, conventions, or architecture changes
- [ ] `pnpm turbo lint type-check test build` passes
- [ ] Commit with conventional commit message

### Between phases
- `/clear` before starting the next phase
- Start fresh — the build plan and code are the source of truth
- Re-read this plan at the start of each session
