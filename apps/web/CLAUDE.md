# @redflag/web

Next.js 16 App Router application — UI, route handlers, tRPC integration.

## What's Here

- `app/` — App Router pages and route handlers
- `app/api/trpc/[trpc]/route.ts` — tRPC route handler (GET + POST)
- `app/api/upload/route.ts` — PDF upload handler (planned, Phase 1)
- `src/trpc/` — Client-side tRPC setup (provider, query client)
- `src/lib/utils.ts` — shadcn/ui utility (`cn` function)
- `src/components/ui/` — shadcn/ui components

## Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Static | Home page with upload UI |
| `/analysis/[id]` | Dynamic | Analysis results page |
| `/api/trpc/[trpc]` | API | tRPC endpoint |
| `/api/upload` | API | PDF upload (planned) |

## tRPC Client Setup

- `splitLink` routes subscriptions to `httpSubscriptionLink` (SSE), everything else to `httpBatchStreamLink`
- `TRPCProvider` wraps the app in `app/layout.tsx`
- `superjson` transformer for serializing Dates and other complex types

## Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` (not the old PostCSS plugin)
- **shadcn/ui** (v4) with Geist font, oklch colors, CSS variables for theming
- `postcss.config.mjs` configures the Tailwind PostCSS plugin

## Config

- `next.config.ts` — `transpilePackages` for all `@redflag/*` packages
- `tsconfig.json` — `declaration: false` (web app doesn't emit .d.ts), `@/*` path alias for `./src/*`

## Rules

- No package may import from `@redflag/web` — dependency direction is one-way
- File upload uses a raw route handler, not tRPC (multipart/form-data)
- Mobile-first responsive design — design for 375px, scale up
