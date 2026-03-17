# @redflag/api

tRPC v11 routers, procedures, and context. Consumed by `apps/web`.

## What's Here

- `src/trpc.ts` — tRPC initialization, context factory (`createTRPCContext({ req })`), `publicProcedure`, `protectedProcedure`. Context extracts user from request cookies via `@supabase/ssr` `parseCookieHeader`.
- `src/__tests__/auth.test.ts` — Auth context and protectedProcedure tests
- `src/root.ts` — Root router combining all sub-routers
- `src/routers/health.ts` — Health check router (`health.check` query)
- `src/routers/analysis.ts` — Analysis router: `analysis.stream` (SSE subscription) + `analysis.get` (query) + `analysis.list` (protectedProcedure, paginated) + `analysis.delete` (protectedProcedure, ownership-verified)
- `src/rateLimit.ts` — Auth-aware rate limiting: `checkRateLimit(identifier, isAuthenticated?)` → `{ limited, resetAt }`. Uses userId (10/day) or IP (2/day). Atomic UPSERT on `rate_limits` table. Exported via `@redflag/api/rateLimit`.
- `src/routers/admin.ts` — Admin router: `admin.dashboard` (adminProcedure, aggregated pipeline metrics by period). `adminProcedure` extends `protectedProcedure` with `ADMIN_EMAIL` env var check.
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
  - Complete → emits `document_text` (with fileType) → `clause_positions` (with startIndex/endIndex) → replays clauses + summary from DB
  - Processing (not stale) → emits `clause_positions` (from cached parse if available, with positions) → polls DB every 3s until analysis completes or fails, replays results. Falls through to claim if it becomes stale.
  - Pending / stale processing → atomic `claimAnalysis()` then runs `analyzeContract()` pipeline (passes `fileType`)
  - Failed → yields error event
- **`analysis.get`** — Query. Returns analysis record + all clauses + `extractedText` (decrypted from documents table) + `fileType` + `documentId`. Enables side-by-side layout on page refresh.
- **`claimAnalysis()`** — Atomic UPDATE with `RETURNING *`. Prevents duplicate pipeline runs. Handles stale processing (>90s without heartbeat).
- **Polling path** — When another connection is processing, replays existing clauses immediately, then polls every 3s for new clauses and status changes. Shows real-time progress even when not running the pipeline.
- **`analysis.list`** — protectedProcedure query. Input: `{ cursor?: string, limit?: number (default 20) }`. Returns paginated user analyses joined with documents. Decrypts filenames. Cursor-based pagination via `createdAt` ordering. Returns `{ items, nextCursor }`.
- **`analysis.delete`** — protectedProcedure mutation. Input: `{ analysisId: string }`. Verifies document ownership (`userId === ctx.user.id`). Decrypts `storagePath` → deletes from Supabase Storage → deletes document (CASCADE handles analyses + clauses). Uses `@supabase/supabase-js` service role client for storage deletion.

## Rules

- File upload is NOT handled by tRPC — use a raw Next.js route handler for multipart
- SSE streaming uses `httpSubscriptionLink` on the client, async generators on the server
- Avoid `.then()` on Drizzle query chains — use `await` + array access instead (Biome's `noThenProperty` rule)
