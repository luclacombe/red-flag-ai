# RedFlag AI

AI contract red-flag detector. Upload a PDF, get clause-by-clause risk analysis with streaming results.

**Build plan:** `docs/BUILD_PLAN.md` — read this at the start of every session.
**Project spec:** `PROJECT.md` — product requirements, RAG knowledge base spec, error handling.
**Tooling:** `TOOLING.md` — MCP servers, skills, development tools.

## Session Rules

1. **Check off BUILD_PLAN.md tasks as you complete them** — as each task is done, not at the end
2. **Update CLAUDE.md files when you change a package** — new files, new exports, new deps, new patterns. Document what exists, not what's planned. Include file paths and gotchas.
3. **Quality gate before commit** — `pnpm turbo lint type-check test build` must pass

## Package Structure

```
apps/web/              → Next.js 16 App Router (UI + route handlers)
packages/api/          → tRPC v11 routers, procedures, context
packages/agents/       → Agent pipeline (gate, hybrid parse, combined analysis, summary)
packages/db/           → Drizzle schema, migrations, client, queries (incl. RAG vector search)
packages/shared/       → Zod schemas, types, constants, logger (all packages import from here)
```

Dependency direction: `web → api → agents → db → shared` (shared is the leaf).

Internal packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`).
No build step per package — Next.js `transpilePackages` compiles them.
Cross-package deps use pnpm `workspace:*` protocol.

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server |
| `pnpm turbo lint` | Biome lint across all packages |
| `pnpm turbo type-check` | TypeScript strict check across all packages |
| `pnpm turbo test` | Vitest across all packages |
| `pnpm turbo build` | Build all packages + Next.js app |
| `pnpm turbo lint type-check test build` | Full quality gate — run before every commit |
| `pnpm run seed` | Seed knowledge base into Supabase (needs API keys) |
| `pnpm supabase:start` | Start local Supabase (Postgres, Auth, Storage, Studio) |
| `pnpm supabase:stop` | Stop local Supabase |
| `pnpm supabase:reset` | Reset local DB (re-apply migrations + seed) |
| `pnpm run setup` | One-command local setup (starts Supabase + installs deps) |

## Conventions

- **TypeScript strict** in all packages — no `any`, no `as` casts unless truly unavoidable
- **Zod validation** at all boundaries: API inputs, Claude responses, SSE events, DB query results
- **Agents are pure async functions** — no classes, no state. Input → output. Testable in isolation.
- **Prompts live in `packages/agents/prompts/`** — one file per agent, template strings
- **Cross-package imports** use aliases: `@redflag/shared`, `@redflag/db`, `@redflag/api`, `@redflag/agents`
- **No `.js` extensions in imports** — use extensionless imports (`./schema`, not `./schema.js`). Turbopack cannot resolve `.js` → `.ts`.
- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- **Drizzle migrations** for all schema changes — never modify DB directly
- **Mobile-first** responsive design — design for 375px, scale up
- **Biome import ordering** is enforced — run `npx biome check --write` after adding new exports to barrel files

## Anti-Patterns — Never Do These

- **Never skip the quality gate.** `pnpm turbo lint type-check test build` must pass before committing.
- **Never use `any` type.** If you can't type it, the design is wrong.
- **Never call Claude without validating the response** against a Zod schema. LLMs return unpredictable shapes.
- **Never expose raw errors to users.** Every error path must surface a human-friendly message.
- **Never store secrets in code.** All keys come from environment variables.
- **Never import from `apps/web` in any package.** Dependency direction is one-way.
- **Never add OCR or image PDF support.** Out of scope for MVP. Detect and reject with clear message.
- **Never bypass auth middleware.** Session refresh via `getUser()` must happen on every request — no code between `createServerClient()` and `getUser()`.
- **Never add new dependencies without checking if an existing one covers it.** Keep the dep tree lean.
- **Never use `eslint` or `prettier`** — this project uses Biome for both linting and formatting.
- **Never use `react-dropzone` or similar.** Native HTML5 drag-and-drop + `<input type="file">` is ~30 lines. No dependency needed.

## MCP Usage Rules

| MCP | When to use |
|-----|-------------|
| **Context7** | Whenever you need API docs: tRPC v11, Drizzle, Supabase client, Anthropic SDK, Voyage AI, Tailwind v4, Next.js 15, shadcn/ui, unpdf |
| **Supabase** | Creating/modifying tables, storage buckets, RLS policies, verifying data |
| **Vercel** | Deployment, env vars, domains, build logs, function logs |
| **Playwright** | Visual QA: screenshot pages → review → fix. Use during UI phases. |
| **21st.dev Magic** | Component generation from natural language. Use during UI phases for polished components. |

## Key Architecture Notes

- **UI design system:** Dark theme (navy-black `#0B1120` bg, light text). Fonts: Space Grotesk (headings) + DM Sans (body). Accent: amber/gold `#F59E0B` for CTAs. Design spec at `docs/UI_SPEC.md`. Animation library: `motion` (landing page only — BackgroundPaths, SlidingWords, ScrollReveal, HowItWorks, SecuritySection). Analysis page uses CSS-only animations. All animated components respect `prefers-reduced-motion`.
- **Multi-format upload:** PDF (unpdf), DOCX (mammoth), TXT (Buffer UTF-8). PDF uses page count limit (≤30), DOCX/TXT use character count limit (≤90,000 chars). Magic bytes validated for PDF (`%PDF-`) and DOCX (`PK\x03\x04`). `fileType` column on documents table tracks format.
- **File upload** uses a raw Next.js route handler (POST `/api/upload`), not tRPC — tRPC doesn't handle multipart
- **Streaming** uses tRPC SSE subscriptions via `httpSubscriptionLink` — async generators yielding typed events
- **Vercel constraint:** first SSE event must emit within 25 seconds. Pipeline emits a status event immediately.
- **RAG vector search** lives in `packages/db`, not `packages/agents` — it's a database query. Bulk fetch by contract type (`getPatternsByContractType()`), injected into system prompt. Orchestrator includes `RAG_TYPE_MAP` to map gate types (e.g. `residential_lease`) to knowledge base types (e.g. `lease`).
- **Claude models:** Haiku for relevance gate + boundary detection fallback (fast/cheap), Sonnet for combined analysis + summary
- **Hybrid clause parsing:** Heuristic regex parser runs first (instant, free). If the result is suspicious (e.g. 1 clause for a large document — common with unconventional formatting), falls back to Haiku LLM anchor-based boundary detection (~1-3s, ~$0.001). Haiku returns the first ~10 words of each clause via `strict: true` tool_use; `splitAtAnchors()` finds them via `indexOf()`. Graceful degradation: if Haiku fails, heuristic result used as-is.
- **Combined streaming analysis:** Single `client.messages.stream()` call with `report_clause` and `report_summary` tools. Claude calls `report_clause` once per clause with brief explanations for green clauses (1 sentence, max 15 words) and full analysis for red/yellow. Uses `strict: true` (constrained decoding — guaranteed valid JSON, zero parse errors) and `eager_input_streaming: true` (fine-grained streaming). Total pipeline: 3-4 API calls (gate + optional Haiku boundary detection + combined analysis + optional summary fallback).
- **Clause positions** (`startIndex`/`endIndex`) are computed by `computeClausePositions()` via `text.indexOf()` with whitespace-normalized fallback (`findAnchorPosition()`) after hybrid parse. Sent in `clause_positions` SSE event as full `PositionedClause[]` (with `startIndex`/`endIndex`) for immediate gray highlighting in the document panel.
- **Document text event** includes `fileType` (`"pdf" | "docx" | "txt"`) — frontend can dispatch to the correct viewer.
- **Frontend streaming UX:** `ProcessingSteps` component shows animated step indicators (connecting → gate → extracting → parsing → analyzing) before clauses arrive. `clause_positions` event triggers all clauses highlighted in gray. Minimum 400ms shimmer per clause via `shimmerStartTimes` + `pendingResults` buffering — `analyzingPositions` is a `Set<number>` so multiple clauses can shimmer simultaneously. Each clause transitions: gray → shimmering (min 400ms) → flash → risk color. Green clauses use `GreenClauseCompact` (1-line inline component). Summary skeleton shown between last clause and summary arrival. Auto-scroll follows analysis (`skeletonRef`) until `userHasInteracted` (detected via wheel/touchmove, not scroll events). Determinate progress bar shows "Analyzed X of N clauses".
- **Side-by-side layout** available in both streaming and DB render paths. `DocumentPanel` dispatches to `TextDocumentPanel` (block-level highlights, paragraph detection, alternating shades for same-risk clauses). Interaction model: `hoveredClause` (visual highlighting only, no scroll) vs `pinnedClause` (click → scroll other panel with `block: "nearest"`). Derived `activeClause = pinnedClause ?? hoveredClause`. Scroll suppression: `isScrollingRef` flag set on scroll events, cleared after 150ms debounce — `onMouseEnter` is no-op during scroll. `ConnectingLines` draws cubic bezier curves between clause highlights and cards; `docScrollContainer` ref from TextDocumentPanel's inner scrollable div ensures lines track document scroll. `analysis.get` returns `extractedText` + `fileType` from documents table for DB render path.
- **Document binary API:** `GET /api/document/[id]` serves decrypted document file binary. Owner-only (auth check). Returns with appropriate Content-Type and private caching. Used for future PDF viewer rendering.
- **Connection pooling:** Use Supabase's transaction pooler URL (port 6543) in Drizzle config, not the direct connection — Vercel serverless creates a new connection per invocation
- **Prompt injection defense:** All agent prompts must frame document text as untrusted input. Zod validates output structure, but system prompts must also instruct Claude to analyze objectively regardless of any instructions in the document
- **Pipeline idempotency:** Use atomic `UPDATE ... WHERE status = 'pending' RETURNING *` to prevent duplicate pipeline runs from concurrent SSE subscriptions. If status is already `processing`, yield persisted clauses from DB instead of re-running
- **Pipeline resumability:** Parse results are cached in `analyses.parsedClauses`. Clause analyses are persisted individually as each `report_clause` tool call completes. On Vercel timeout + reconnect, the pipeline skips completed work and resumes from where it left off. Heartbeat updates `updatedAt` after each yielded event to prevent premature stale detection (90s threshold).
- **Clause position strategy:** Hybrid parse returns clause text; orchestrator computes `startIndex`/`endIndex` via `text.indexOf()`. Claude references clauses by position number only (no verbatim copying in output — saves ~50% output tokens).
- **Performance characteristics:** First clause result in ~8-10s from upload. Full analysis in ~20-30s for typical contracts. Zero JSON parse errors (guaranteed by `strict: true` structured outputs). Zero Vercel timeouts (heartbeat-based keepalive).
- **Response language selection:** Users choose what language Claude writes explanations in, independent of the document language. 15 supported languages (Tier 1-2 from Anthropic benchmarks). `SUPPORTED_LANGUAGES` constant in `@redflag/shared`. System prompts stay in English. `saferAlternative` stays in the document's original language. `responseLanguage` stored on analysis record, threaded through orchestrator → combined analysis → summary. `LanguageSelector` component with `localStorage` persistence, defaults to `navigator.language`.
- **Shareable URLs:** Analysis pages have dynamic OG meta tags via `generateMetadata()`. Tags include risk score, recommendation, contract type, and clause breakdown. Dynamic OG image at `/api/og/[id]` renders risk score circle + recommendation badge via `next/og` `ImageResponse` (edge runtime). Twitter card tags also included.
- **PDF report export:** `GET /api/report/[id]` generates a downloadable PDF report using `@react-pdf/renderer`. Layout: branded header, summary section (score, recommendation, contract type, date, breakdown), top concerns, clause-by-clause analysis with risk badges and safer alternatives, legal disclaimer footer with page numbers. Returns `Content-Disposition: attachment`.
- **Share + Download buttons:** `AnalysisActions` component shows Share (clipboard copy with "Copied!" feedback) and Download PDF buttons. Appears when analysis is complete (both DB render and post-streaming states).
- **Supabase Auth:** Email/password + magic link via `@supabase/ssr`. Three client utilities in `apps/web/src/lib/supabase/`: `client.ts` (browser, `createBrowserClient`), `server.ts` (server components, `createServerClient` + `cookies()`), `middleware.ts` (session refresh, `updateSession()`). Next.js middleware at `apps/web/middleware.ts` calls `updateSession()` on every request. Public routes: `/`, `/login`, `/signup`, `/auth/*`, `/analysis/*`, `/api/*`. Auth pages: `/login`, `/signup`. Callback routes: `/auth/callback` (code exchange), `/auth/confirm` (email OTP verification).
- **tRPC auth context:** `createTRPCContext({ req })` extracts user from request cookies via `@supabase/ssr` `parseCookieHeader`. Returns `{ user: User | null }`. `protectedProcedure` throws `UNAUTHORIZED` if `!ctx.user`. `publicProcedure` remains for unauthenticated access (viewing shared analyses).
- **Auth-aware rate limiting:** `checkRateLimit(identifier, isAuthenticated)` — authenticated users get 10/day (by userId), anonymous get 2/day (by IP). Constants: `RATE_LIMIT_PER_DAY` (2), `RATE_LIMIT_AUTH_PER_DAY` (10) in `@redflag/shared`.
- **Upload route auth:** Extracts user from cookies via `@supabase/ssr`. Sets `userId` on document record when authenticated. Storage path: `{userId}/{uuid}/{filename}` for auth users, `anonymous/{uuid}/{filename}` for anon.
- **NavBar auth state:** Client component with `useEffect` for `getUser()` + `onAuthStateChange`. Authenticated: dropdown menu with History link, Sign out, Delete account (with `ConfirmDialog`). Unauthenticated: "Sign in" link.
- **Analysis history:** `/history` page (protected by middleware redirect). `HistoryView` client component uses `trpc.analysis.list.useInfiniteQuery` with cursor-based pagination. Each item shows risk score, document name, contract type badge, recommendation badge, date. Delete button per item + on analysis page itself. Empty state for new users. Dark theme consistent with Phase 6.
- **Row Level Security:** RLS enabled on all tables. Documents: owner-only CRUD for authenticated users. Analyses + clauses: public SELECT (shared analysis pages), owner-only INSERT/UPDATE via documents join. Knowledge patterns: public SELECT. Storage: users upload/read own folder only. Pipeline writes use Drizzle (bypasses RLS). Index on `documents.user_id`.
- **Application-level encryption:** AES-256-GCM via `node:crypto` in `packages/shared/src/crypto.ts`. Exported via `@redflag/shared/crypto` (separate subpath, NOT in the main barrel — edge runtime can't use `node:crypto`). HKDF-SHA256 derives per-document keys from `MASTER_ENCRYPTION_KEY` env var using documentId as salt and `"document"` or `"clause"` as info. Encrypted format: `"iv.tag.ciphertext"` (base64, dot-separated). Column types stay text. Encrypted fields: `extractedText`, `filename`, `storagePath` (documents); `clauseText`, `explanation`, `saferAlternative` (clauses); `topConcerns`, `summaryText`, `parsedClauses` (analyses). Uploaded files encrypted with `encryptBuffer` before Storage upload. SSE stream sends plaintext — encryption is at-rest only. `keyVersion` column on documents tracks encryption version for future rotation.
- **IP address hashing:** HMAC-SHA256 in `checkRateLimit()`. Key derived via HKDF from master key with `"rate-limit"` salt and `"ip-hash"` info. Not reversible (GDPR-compliant). Rate limit lookups use the hashed identifier.
- **Auto-deletion cron:** `GET /api/cron/cleanup` runs daily at 02:00 UTC via Vercel Cron. Deletes documents >30 days old (CASCADE handles analyses + clauses). Decrypts `storagePath` to delete from Storage. Deletes `rate_limits` rows >7 days old. Verifies `CRON_SECRET` bearer token. Config in `vercel.json`.
- **Pipeline observability:** `pipeline_metrics` table tracks timing, token usage, model, and success/failure for each pipeline step (gate, parse, combined_analysis, summary_fallback). Each agent accepts an optional `onUsage` callback (or `usageRef` for streaming) to report `{ inputTokens, outputTokens }` from `response.usage`. Orchestrator wraps each step with `Date.now()` timing and calls `recordPipelineMetric()` (fire-and-forget). Gate metrics recorded in upload route. Admin dashboard at `/admin` (gated by `ADMIN_EMAIL` env var, no NavBar link). `admin` tRPC router uses `adminProcedure` (protectedProcedure + email check). Dashboard shows stats cards (total analyses, success rate, avg duration, estimated cost), recent analyses table with per-step timing, and error log.

## Current Stack Versions

| Dependency | Version | Notes |
|-----------|---------|-------|
| Next.js | 16.1.6 | App Router, Turbopack |
| React | 19.2.4 | |
| tRPC | 11.12.0 | v11 API — NOT v10 patterns |
| Drizzle ORM | 0.45.1 | `postgres` driver via `drizzle-orm/postgres-js` |
| Zod | 4.3.6 | v4 — API is backwards-compatible with v3 |
| Tailwind CSS | 4.2.1 | v4 with `@tailwindcss/postcss` — NOT the old PostCSS plugin |
| Biome | 2.4.7 | v2 config format — `organizeImports` is under `assist.actions.source` |
| Vitest | 4.1.0 | |
| TypeScript | 5.9.3 | |
| mammoth | 1.12.0 | DOCX text extraction (apps/web only) |
| @react-pdf/renderer | 4.3.2 | Server-side PDF report generation (apps/web only) |
| @supabase/ssr | latest | Auth session management — browser/server/middleware clients (apps/web + packages/api) |
| Turborepo | 2.8.17 | |

## Supabase

- **Project:** `red-flag-ai` (region: eu-west-1)
- **DB tables:** documents, analyses, clauses, knowledge_patterns, rate_limits, pipeline_metrics
- **Storage bucket:** `contracts` (private, 10MB max, PDF/DOCX/TXT)
- **pgvector extension** enabled, HNSW index on `knowledge_patterns.embedding`
- **Connection:** transaction pooler URL (port 6543) with `{ prepare: false }`
- **Auth:** Email/password + magic links enabled. `@supabase/ssr` for session management.
- **RLS:** Enabled on all tables. Documents owner-only, analyses/clauses/knowledge_patterns public SELECT. Storage scoped to user folder.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MASTER_ENCRYPTION_KEY`, `CRON_SECRET`, `ADMIN_EMAIL`

## Local Development (Supabase CLI)

- **Setup:** `pnpm run setup` (starts Supabase + installs deps) → `cp .env.development .env.local` → add `ANTHROPIC_API_KEY` → `pnpm dev`
- **Prerequisites:** Node.js 22+, pnpm 10+, Docker Desktop, Supabase CLI 2.x
- **Local ports:** API 54321, Postgres 54322, Studio 54323
- **Config:** `supabase/config.toml` — project settings, auth, storage bucket
- **Migrations:** `supabase/migrations/` — 4 files: pgvector extension, consolidated schema (all 5 tables), RLS policies, pipeline_metrics table
- **Seed:** `supabase/seed.sql` — 150 knowledge patterns with pre-computed Voyage AI embeddings (no API key needed)
- **Env template:** `.env.development` — committed to git with well-known local Supabase keys + dev encryption key. Copy to `.env.local` and add `ANTHROPIC_API_KEY`.
- **Reset:** `pnpm supabase:reset` re-applies all migrations + seed
- **DB client:** `packages/db/src/client.ts` uses `{ prepare: false }` — works for both Supabase pooler (production) and direct connection (local)
