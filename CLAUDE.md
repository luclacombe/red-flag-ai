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
packages/agents/       → Agent pipeline (gate, parse, risk, rewrite, summary)
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
- **RAG vector search** lives in `packages/db`, not `packages/agents` — it's a database query
- **Claude models:** Haiku for relevance gate (fast/cheap), Sonnet for all other agents
- **Clause positions** (`startIndex`/`endIndex`) are stored even though the MVP uses a vertical card stack — this enables future side-by-side view with zero schema changes
- **Connection pooling:** Use Supabase's transaction pooler URL (port 6543) in Drizzle config, not the direct connection — Vercel serverless creates a new connection per invocation
- **Prompt injection defense:** All agent prompts must frame document text as untrusted input. Zod validates output structure, but system prompts must also instruct Claude to analyze objectively regardless of any instructions in the document
- **Pipeline idempotency:** Use atomic `UPDATE ... WHERE status = 'pending' RETURNING *` to prevent duplicate pipeline runs from concurrent SSE subscriptions. If status is already `processing`, yield persisted clauses from DB instead of re-running
- **Clause position strategy:** Don't rely on Claude for character offsets — LLMs can't count. Have Claude return clause text, then compute `startIndex`/`endIndex` via `text.indexOf(clauseText)` in the orchestrator

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
