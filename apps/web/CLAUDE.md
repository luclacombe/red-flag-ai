# @redflag/web

Next.js 16 App Router application — UI, route handlers, tRPC integration.

## What's Here

- `app/` — App Router pages and route handlers
- `app/api/trpc/[trpc]/route.ts` — tRPC route handler (GET + POST)
- `app/api/upload/route.ts` — PDF upload handler (POST, multipart/form-data)
- `app/api/upload/__tests__/route.test.ts` — Upload route tests (10 tests)
- `src/trpc/` — Client-side tRPC setup (provider, query client)
- `src/lib/utils.ts` — shadcn/ui utility (`cn` function)
- `src/components/ui/` — shadcn/ui components

## Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Static | Home page with upload UI |
| `/analysis/[id]` | Dynamic | Analysis results page |
| `/api/trpc/[trpc]` | API | tRPC endpoint |
| `/api/upload` | API | PDF upload → validate → extract → gate → create records |

## Upload Route (`POST /api/upload`)

Validation order: MIME type → magic bytes (`%PDF-`) → file size (≤10MB) → extract text (unpdf) → page count (≤30) → empty text check → min text length (50 chars).

After validation: upload to Supabase Storage → create document record → run relevance gate → if contract: update document + create analysis record.

Returns:
- Not contract: `{ isContract: false, reason: "..." }`
- Contract: `{ isContract: true, analysisId, contractType, language }`
- Error: `{ error: "..." }` with appropriate HTTP status

## tRPC Client Setup

- `splitLink` routes subscriptions to `httpSubscriptionLink` (SSE), everything else to `httpBatchStreamLink`
- `TRPCProvider` wraps the app in `app/layout.tsx`
- `superjson` transformer for serializing Dates and other complex types

## Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` (not the old PostCSS plugin)
- **shadcn/ui** (v4) with Geist font, oklch colors, CSS variables for theming
- `postcss.config.mjs` configures the Tailwind PostCSS plugin

## Dependencies

- `unpdf` — PDF text extraction (`getDocumentProxy` + `extractText`)
- `@supabase/supabase-js` — Supabase Storage uploads (service role key)
- `@redflag/agents` — Relevance gate (`relevanceGate`)
- `@redflag/db` — Database inserts/updates (documents, analyses tables)
- `@redflag/shared` — Zod schemas, constants

## Config

- `next.config.ts` — `transpilePackages` for all `@redflag/*` packages
- `tsconfig.json` — `declaration: false` (web app doesn't emit .d.ts), `@/*` path alias for `./src/*`

## Rules

- No package may import from `@redflag/web` — dependency direction is one-way
- File upload uses a raw route handler, not tRPC (multipart/form-data)
- Mobile-first responsive design — design for 375px, scale up
