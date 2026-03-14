# @redflag/api

tRPC v11 routers, procedures, and context. Consumed by `apps/web`.

## What's Here

- `src/trpc.ts` — tRPC initialization, context factory, procedure helpers
- `src/root.ts` — Root router combining all sub-routers
- `src/routers/health.ts` — Health check router (`health.check` query)
- `src/routers/analysis.ts` — Analysis router: `analysis.stream` (SSE subscription) + `analysis.get` (query)
- `src/index.ts` — Barrel export: `appRouter`, `AppRouter` type, `createTRPCContext`, `createCallerFactory`

## tRPC v11 Patterns

- **NOT v10** — do not use v10 patterns (different transformer config, different subscription API)
- Router uses `initTRPC.context<typeof createTRPCContext>().create({ transformer: superjson })`
- Subscriptions use async generators (`async function*`), not Observables
- `createCallerFactory` for server-side calls and testing
- Route handler uses `fetchRequestHandler` from `@trpc/server/adapters/fetch`

## Adding a New Router

1. Create `src/routers/my-router.ts`
2. Import `publicProcedure` and `router` from `../trpc`
3. Add to `src/root.ts` in the root router
4. Types flow automatically via `AppRouter`

## Analysis Router

- **`analysis.stream`** — SSE subscription. Input: `{ analysisId: string (uuid) }`. Dual path:
  - Complete → replays clauses + summary from DB
  - Processing (not stale) → yields existing clauses, returns status message
  - Pending / stale processing → atomic `claimAnalysis()` then runs `analyzeContract()` pipeline
  - Failed → yields error event
- **`analysis.get`** — Query. Returns analysis record + all clauses (for page refresh without SSE)
- **`claimAnalysis()`** — Atomic UPDATE with `RETURNING *`. Prevents duplicate pipeline runs. Handles stale processing (>10 min).

## Rules

- File upload is NOT handled by tRPC — use a raw Next.js route handler for multipart
- SSE streaming uses `httpSubscriptionLink` on the client, async generators on the server
- Avoid `.then()` on Drizzle query chains — use `await` + array access instead (Biome's `noThenProperty` rule)
