# @redflag/api

tRPC v11 routers, procedures, and context. Consumed by `apps/web`.

## What's Here

- `src/trpc.ts` — tRPC initialization, context factory, procedure helpers
- `src/root.ts` — Root router combining all sub-routers
- `src/routers/` — Individual routers (currently: `health.ts`)
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

## Rules

- File upload is NOT handled by tRPC — use a raw Next.js route handler for multipart
- SSE streaming uses `httpSubscriptionLink` on the client, async generators on the server
