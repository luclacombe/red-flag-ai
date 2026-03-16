# @redflag/api

tRPC v11 routers, procedures, and context. Consumed by `apps/web`.

## What's Here

- `src/trpc.ts` — tRPC initialization, context factory (`createTRPCContext({ req })`), `publicProcedure`, `protectedProcedure`. Context extracts user from request cookies via `@supabase/ssr` `parseCookieHeader`.
- `src/__tests__/auth.test.ts` — Auth context and protectedProcedure tests
- `src/root.ts` — Root router combining all sub-routers
- `src/routers/health.ts` — Health check router (`health.check` query)
- `src/routers/analysis.ts` — Analysis router: `analysis.stream` (SSE subscription) + `analysis.get` (query)
- `src/rateLimit.ts` — Auth-aware rate limiting: `checkRateLimit(identifier, isAuthenticated?)` → `{ limited, resetAt }`. Uses userId (10/day) or IP (2/day). Atomic UPSERT on `rate_limits` table. Exported via `@redflag/api/rateLimit`.
- `src/index.ts` — Barrel export: `appRouter`, `AppRouter` type, `TRPCContext` type, `createTRPCContext`, `createCallerFactory`, `protectedProcedure`

## tRPC v11 Patterns

- **NOT v10** — do not use v10 patterns (different transformer config, different subscription API)
- Router uses `initTRPC.context<TRPCContext>().create({ transformer: superjson })`
- Context: `{ user: User | null }` — extracted from request cookies via `@supabase/ssr`
- `protectedProcedure` throws `UNAUTHORIZED` if `!ctx.user`
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
  - Complete → emits `clause_positions` → replays clauses + summary from DB
  - Processing (not stale) → emits `clause_positions` (from cached parse if available) → polls DB every 3s until analysis completes or fails, replays results. Falls through to claim if it becomes stale.
  - Pending / stale processing → atomic `claimAnalysis()` then runs `analyzeContract()` pipeline
  - Failed → yields error event
- **`analysis.get`** — Query. Returns analysis record + all clauses (for page refresh without SSE)
- **`claimAnalysis()`** — Atomic UPDATE with `RETURNING *`. Prevents duplicate pipeline runs. Handles stale processing (>90s without heartbeat).
- **Polling path** — When another connection is processing, replays existing clauses immediately, then polls every 3s for new clauses and status changes. Shows real-time progress even when not running the pipeline.

## Rules

- File upload is NOT handled by tRPC — use a raw Next.js route handler for multipart
- SSE streaming uses `httpSubscriptionLink` on the client, async generators on the server
- Avoid `.then()` on Drizzle query chains — use `await` + array access instead (Biome's `noThenProperty` rule)
