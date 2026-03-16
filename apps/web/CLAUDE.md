# @redflag/web

Next.js 16 App Router application — UI, route handlers, tRPC integration.

## What's Here

- `app/` — App Router pages and route handlers
- `app/fonts.ts` — Google Fonts: Space Grotesk (headings) + DM Sans (body)
- `app/globals.css` — Tailwind v4 theme tokens, shadcn colors, custom keyframes (`bounce-dots`, `fade-slide-in`, `text-shimmer`), `.text-shimmer` class with `prefers-reduced-motion` fallback
- `app/api/trpc/[trpc]/route.ts` — tRPC route handler (GET + POST). `runtime = "nodejs"`, `maxDuration = 300`.
- `app/api/upload/route.ts` — PDF upload handler (POST, multipart/form-data). Rate limiting via `checkRateLimit`. `runtime = "nodejs"`, `maxDuration = 300`.
- `app/api/upload/__tests__/route.test.ts` — Upload route tests (13 tests — validation, gate, rate limiting)
- `src/trpc/` — Client-side tRPC setup (provider, query client)
- `src/lib/utils.ts` — shadcn/ui utility (`cn` function)
- `src/components/ui/` — shadcn/ui primitives: badge, button, card, collapsible, separator, skeleton
- `src/components/` — Custom components (see Components section)

## Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Static | Landing page: hero, upload zone, how it works, footer |
| `/analysis/[id]` | Dynamic | Analysis results page. `generateMetadata()` fetches analysis for dynamic OG tags. Server component passes id to `AnalysisView` client component. Dual path: SSE streaming for pending/processing, DB render for complete/failed. Share + Download PDF buttons appear when analysis is complete. |
| `/api/trpc/[trpc]` | API | tRPC endpoint |
| `/api/upload` | API | PDF upload → validate → extract → gate → create records |
| `/api/report/[id]` | API (GET) | PDF report generation. Fetches analysis + clauses, renders PDF via `@react-pdf/renderer`, returns with `Content-Disposition: attachment`. `runtime = "nodejs"`, `maxDuration = 30`. |
| `/api/og/[id]` | API (GET) | Dynamic OG image generation. Uses `next/og` `ImageResponse` to render risk score circle + recommendation badge + clause breakdown. `runtime = "edge"`. |

## Components

### Landing page components
| Component | File | Notes |
|-----------|------|-------|
| `NavBar` | `nav-bar.tsx` | Dark bg, logo left, "How it works" anchor right |
| `HeroSection` | `hero-section.tsx` | Dark bg, BackgroundPaths + headline + TextShimmer subtitle + CTA |
| `BackgroundPaths` | `background-paths.tsx` | Animated SVG paths in risk colors (motion library). 16 paths, 2-4px strokes. `prefers-reduced-motion` respected. |
| `TextShimmer` | `text-shimmer.tsx` | Gradient text animation (motion library). `prefers-reduced-motion` respected. |
| `UploadZone` | `upload-zone.tsx` | Native HTML5 drag-drop + file input. States: idle, drag-over, uploading (progress bar), processing (dots), error, rejection, rate-limit. Handles POST to `/api/upload`. Includes LanguageSelector below drop zone. |
| `LanguageSelector` | `language-selector.tsx` | Globe icon + native `<select>` with 15 languages (native names). Persists to `localStorage`. Defaults to `navigator.language`. Also exports `useResponseLanguage()` hook. |
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

### Analysis page components
| Component | File | Notes |
|-----------|------|-------|
| `AnalysisView` | `analysis-view.tsx` | Client component. Dual-path: tRPC query for initial state, SSE subscription for streaming. Handles `clause_positions` event for instant skeleton cards, replaces each with a `ClauseCard` as `clause_analysis` events arrive. Determinate progress ("Analyzed X of N clauses"). Manages all 5 page states (loading, streaming, complete, failed, 404). Shows `AnalysisActions` (Share + Download PDF) when analysis is complete. |
| `AnalysisActions` | `analysis-actions.tsx` | Share button (clipboard copy with "Copied!" feedback) + Download PDF link (`/api/report/[id]`). Appears in complete state (from DB) and after streaming finishes. |
| `ClauseCard` | `clause-card.tsx` | 4px left border (risk color), category tag, RiskBadge, collapsible clause text (line-clamp-3), explanation, collapsible safer alternative (green-50 bg, chevron). CSS fade-slide-in animation. |
| `StatusBar` | `status-bar.tsx` | Blue bar below nav. CSS-only text shimmer animation (no motion library). `prefers-reduced-motion`: static text + pulsing dot. `aria-live="polite"`. |
| `ProgressBar` | `progress-bar.tsx` | Thin amber bar showing determinate progress (X of N clauses). CSS transition on width. `role="progressbar"` with `aria-valuenow/min/max`. |
| `RecommendationBadge` | `recommendation-badge.tsx` | Large pill: "Safe to Sign" (green) / "Proceed with Caution" (amber) / "Do Not Sign" (red). Uses `Recommendation` type. |
| `BreakdownBar` | `breakdown-bar.tsx` | Horizontal stacked bar (red|amber|green segments) with dot + count labels. Pure div widths, no charting library. |
| `SummaryPanel` | `summary-panel.tsx` | Composed: RiskScore + RecommendationBadge + BreakdownBar + top concerns list + contract type/language. Fade-in animation. |

## Upload Route (`POST /api/upload`)

Accepts PDF, DOCX, and TXT files. Order: **rate limit check** → MIME type (pdf/docx/txt) → file size (≤10MB) → type-specific extraction (PDF: magic bytes + unpdf + page count ≤30; DOCX: PK magic bytes + mammoth + char count ≤90k; TXT: UTF-8 decode + char count ≤90k) → empty text check → min text length (50 chars).

After validation: upload to Supabase Storage → create document record → run relevance gate → if contract: update document + create analysis record.

Rate limit uses `checkRateLimit(ip)` from `@redflag/api/rateLimit`. If DB fails, degrades gracefully (continues without rate limiting).

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
- `mammoth` — DOCX text extraction (`mammoth.extractRawText()`)
- `@react-pdf/renderer` — Server-side PDF report generation (`renderToBuffer`). Used in `/api/report/[id]`.
- `motion` — Animation library for BackgroundPaths + TextShimmer (landing page only)
- `@supabase/supabase-js` — Supabase Storage uploads (service role key)
- `@redflag/agents` — Relevance gate (`relevanceGate`)
- `@redflag/api` — Rate limiting (`checkRateLimit` via `@redflag/api/rateLimit`)
- `@redflag/db` — Database inserts/updates (documents, analyses tables)
- `@redflag/shared` — Zod schemas, constants, `RiskLevel` type, `logger`

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
