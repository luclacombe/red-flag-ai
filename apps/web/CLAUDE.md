# @redflag/web

Next.js 16 App Router application — UI, route handlers, tRPC integration.

## What's Here

- `app/` — App Router pages and route handlers
- `app/fonts.ts` — Google Fonts: Space Grotesk (headings) + DM Sans (body)
- `app/globals.css` — Tailwind v4 theme tokens, shadcn colors, custom keyframes
- `app/api/trpc/[trpc]/route.ts` — tRPC route handler (GET + POST)
- `app/api/upload/route.ts` — PDF upload handler (POST, multipart/form-data)
- `app/api/upload/__tests__/route.test.ts` — Upload route tests (10 tests)
- `src/trpc/` — Client-side tRPC setup (provider, query client)
- `src/lib/utils.ts` — shadcn/ui utility (`cn` function)
- `src/components/ui/` — shadcn/ui primitives: badge, button, card, collapsible, separator, skeleton
- `src/components/` — Custom components (see Components section)

## Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Static | Landing page: hero, upload zone, how it works, footer |
| `/analysis/[id]` | Dynamic | Analysis results page |
| `/api/trpc/[trpc]` | API | tRPC endpoint |
| `/api/upload` | API | PDF upload → validate → extract → gate → create records |

## Components

### Landing page components
| Component | File | Notes |
|-----------|------|-------|
| `NavBar` | `nav-bar.tsx` | Dark bg, logo left, "How it works" anchor right |
| `HeroSection` | `hero-section.tsx` | Dark bg, BackgroundPaths + headline + TextShimmer subtitle + CTA |
| `BackgroundPaths` | `background-paths.tsx` | Animated SVG paths in risk colors (motion library). 16 paths, 2-4px strokes. `prefers-reduced-motion` respected. |
| `TextShimmer` | `text-shimmer.tsx` | Gradient text animation (motion library). `prefers-reduced-motion` respected. |
| `UploadZone` | `upload-zone.tsx` | Native HTML5 drag-drop + file input. States: idle, drag-over, uploading (progress bar), processing (dots), error, rejection, rate-limit. Handles POST to `/api/upload`. |
| `HowItWorks` | `how-it-works.tsx` | 3 steps with Lucide icons. Horizontal on desktop, vertical on mobile. |
| `LegalDisclaimer` | `legal-disclaimer.tsx` | Footer. Not dismissable. |

### Shared components (used in landing + results pages)
| Component | File | Notes |
|-----------|------|-------|
| `RiskBadge` | `risk-badge.tsx` | Pill badge with Lucide icon. 3 variants: red/yellow/green. Uses `RiskLevel` from `@redflag/shared`. |
| `RiskScore` | `risk-score.tsx` | SVG circular gauge. CSS-animated. Color by score range: 0-33 green, 34-66 amber, 67-100 red. |
| `ProcessingLoader` | `processing-loader.tsx` | Bouncing dots (CSS keyframes). Amber dots + configurable text. |
| `ClauseSkeleton` | `clause-skeleton.tsx` | Pulse animation matching clause card shape. CSS only. |
| `ErrorState` | `error-state.tsx` | AlertCircle icon + message + optional retry button. |

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
- **Fonts:** Space Grotesk (`--font-heading`) for headings, DM Sans (`--font-body`) for body. Loaded via `next/font/google`.
- **shadcn/ui** (v4) with oklch colors, CSS variables for theming
- **Design system:** `design-system/redflag-ai/MASTER.md` defines tokens (colors, fonts, spacing, animation rules)
- `postcss.config.mjs` configures the Tailwind PostCSS plugin

## Dependencies

- `unpdf` — PDF text extraction (`getDocumentProxy` + `extractText`)
- `motion` — Animation library for BackgroundPaths + TextShimmer (landing page only)
- `@supabase/supabase-js` — Supabase Storage uploads (service role key)
- `@redflag/agents` — Relevance gate (`relevanceGate`)
- `@redflag/db` — Database inserts/updates (documents, analyses tables)
- `@redflag/shared` — Zod schemas, constants, `RiskLevel` type

## Config

- `next.config.ts` — `transpilePackages` for all `@redflag/*` packages
- `tsconfig.json` — `declaration: false` (web app doesn't emit .d.ts), `@/*` path alias for `./src/*`

## Rules

- No package may import from `@redflag/web` — dependency direction is one-way
- File upload uses a raw route handler, not tRPC (multipart/form-data)
- Mobile-first responsive design — design for 375px, scale up
- `motion` library used ONLY on landing page (BackgroundPaths, TextShimmer). Analysis page is CSS-only.
- All animated components must respect `prefers-reduced-motion`
- Native HTML5 drag-drop for upload — no `react-dropzone`
