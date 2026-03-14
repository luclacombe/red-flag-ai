# @redflag/db

Database layer — Drizzle schema, client, migrations, and query functions (including RAG vector search).

## What's Here

- `src/schema.ts` — 5 tables: documents, analyses, clauses, knowledge_patterns, rate_limits
- `src/client.ts` — Lazy-initialized Drizzle client (`db` proxy + `getDb()`) with `{ prepare: false }` for Supabase pooler
- `src/index.ts` — Barrel export (also re-exports `eq` from `drizzle-orm` so web app doesn't need a direct dep)
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
- **jsonb columns:** `top_concerns`, `matched_patterns`, `contract_type` — typed with `$type<string[]>()`

## Rules

- All schema changes require a Drizzle migration — never modify DB directly
- RAG vector search queries live here, not in `packages/agents`
- `DATABASE_URL` env var is validated at first DB access (lazy), not at import time — prevents build failures
- Drizzle operators (e.g., `eq`) are re-exported from `src/index.ts` — import from `@redflag/db`, not `drizzle-orm`
