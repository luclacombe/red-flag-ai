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
- **Never add auth login flows.** Supabase Auth skeleton is wired but gating is post-MVP.
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

- **File upload** uses a raw Next.js route handler (POST `/api/upload`), not tRPC — tRPC doesn't handle multipart
- **Streaming** uses tRPC SSE subscriptions via `httpSubscriptionLink` — async generators yielding typed events
- **Vercel constraint:** first SSE event must emit within 25 seconds. Pipeline emits a status event immediately.
- **RAG vector search** lives in `packages/db`, not `packages/agents` — it's a database query. Bulk fetch by contract type (`getPatternsByContractType()`), injected into system prompt. Orchestrator includes `RAG_TYPE_MAP` to map gate types (e.g. `residential_lease`) to knowledge base types (e.g. `lease`).
- **Claude models:** Haiku for relevance gate + boundary detection fallback (fast/cheap), Sonnet for combined analysis + summary
- **Hybrid clause parsing:** Heuristic regex parser runs first (instant, free). If the result is suspicious (e.g. 1 clause for a large document — common with unconventional formatting), falls back to Haiku LLM anchor-based boundary detection (~1-3s, ~$0.001). Haiku returns the first ~10 words of each clause via `strict: true` tool_use; `splitAtAnchors()` finds them via `indexOf()`. Graceful degradation: if Haiku fails, heuristic result used as-is.
- **Combined streaming analysis:** Single `client.messages.stream()` call with `report_clause` and `report_summary` tools. Claude calls `report_clause` once per clause with brief explanations for green clauses (1 sentence, max 15 words) and full analysis for red/yellow. Uses `strict: true` (constrained decoding — guaranteed valid JSON, zero parse errors) and `eager_input_streaming: true` (fine-grained streaming). Total pipeline: 3-4 API calls (gate + optional Haiku boundary detection + combined analysis + optional summary fallback).
- **Clause positions** (`startIndex`/`endIndex`) are computed by `computeClausePositions()` via `text.indexOf()` with whitespace-normalized fallback (`findAnchorPosition()`) after hybrid parse. Stored even though MVP uses vertical card stack — enables future side-by-side view.
- **Frontend streaming UX:** Server emits `clause_positions` event immediately after parse. Frontend renders exact number of skeleton cards instantly, replaces each with a colored `ClauseCard` as `clause_analysis` events stream in. Green clauses stream quickly (brief explanations), risky clauses take longer (full analysis). Determinate progress bar shows "Analyzed X of N clauses".
- **Connection pooling:** Use Supabase's transaction pooler URL (port 6543) in Drizzle config, not the direct connection — Vercel serverless creates a new connection per invocation
- **Prompt injection defense:** All agent prompts must frame document text as untrusted input. Zod validates output structure, but system prompts must also instruct Claude to analyze objectively regardless of any instructions in the document
- **Pipeline idempotency:** Use atomic `UPDATE ... WHERE status = 'pending' RETURNING *` to prevent duplicate pipeline runs from concurrent SSE subscriptions. If status is already `processing`, yield persisted clauses from DB instead of re-running
- **Pipeline resumability:** Parse results are cached in `analyses.parsedClauses`. Clause analyses are persisted individually as each `report_clause` tool call completes. On Vercel timeout + reconnect, the pipeline skips completed work and resumes from where it left off. Heartbeat updates `updatedAt` after each yielded event to prevent premature stale detection (90s threshold).
- **Clause position strategy:** Hybrid parse returns clause text; orchestrator computes `startIndex`/`endIndex` via `text.indexOf()`. Claude references clauses by position number only (no verbatim copying in output — saves ~50% output tokens).
- **Performance characteristics:** First clause result in ~8-10s from upload. Full analysis in ~20-30s for typical contracts. Zero JSON parse errors (guaranteed by `strict: true` structured outputs). Zero Vercel timeouts (heartbeat-based keepalive).

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
| Turborepo | 2.8.17 | |

## Supabase

- **Project:** `red-flag-ai` (region: eu-west-1)
- **DB tables:** documents, analyses, clauses, knowledge_patterns, rate_limits
- **Storage bucket:** `contracts` (private, 10MB max, PDF only)
- **pgvector extension** enabled, HNSW index on `knowledge_patterns.embedding`
- **Connection:** transaction pooler URL (port 6543) with `{ prepare: false }`
