# @redflag/web

Next.js 16 App Router application — UI, route handlers, tRPC integration.

## What's Here

- `app/` — App Router pages and route handlers
- `app/fonts.ts` — Google Fonts: Space Grotesk (headings) + DM Sans (body)
- `app/globals.css` — Tailwind v4 theme tokens, shadcn colors, custom keyframes (`bounce-dots`, `fade-slide-in`, `text-shimmer`), `.text-shimmer` class with `prefers-reduced-motion` fallback
- `app/api/trpc/[trpc]/route.ts` — tRPC route handler (GET + POST). `runtime = "nodejs"`, `maxDuration = 300`.
- `app/api/upload/route.ts` — Upload handler (POST, multipart/form-data). Auth-aware rate limiting (userId 10/day, IP 2/day). Sets `userId` on document when authenticated. Rate limit DB failure returns 503 (fail-closed). `runtime = "nodejs"`, `maxDuration = 300`.
- `app/api/upload/__tests__/route.test.ts` — Upload route tests (26 tests — validation, gate, rate limiting, auth)
- `app/login/page.tsx` — Sign in page (email/password + magic link)
- `app/signup/page.tsx` — Registration page (email/password)
- `app/auth/callback/route.ts` — OAuth/magic link code exchange → session
- `app/auth/confirm/route.ts` — Email OTP verification (token_hash + type)
- `middleware.ts` — Next.js middleware: session refresh via `updateSession()`. Public routes: `/`, `/login`, `/signup`, `/auth/*`, `/analysis/*`, `/api/*`.
- `src/lib/supabase/client.ts` — Browser Supabase client (`createBrowserClient`)
- `src/lib/supabase/server.ts` — Server component Supabase client (`createServerClient` + `cookies()`)
- `src/lib/supabase/middleware.ts` — Middleware session refresh (`updateSession()`)
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
| `/api/report/[id]` | API (GET) | PDF report generation. Auth + ownership check (owner, anonymous uploads, or active share link). Fetches analysis + clauses, renders PDF via `@react-pdf/renderer`, returns with `Content-Disposition: attachment`. `runtime = "nodejs"`, `maxDuration = 30`. |
| `/api/og/[id]` | API (GET) | Dynamic OG image generation. Only shows detailed image for shared or anonymous analyses; private analyses get generic fallback. Uses `next/og` `ImageResponse`. `runtime = "edge"`. |
| `/login` | Static | Email/password + magic link sign in. Redirects to `/` on success. |
| `/signup` | Static | Registration form. Shows confirmation message on success. |
| `/auth/callback` | API (GET) | Exchanges auth code for session (magic link + OAuth). |
| `/auth/confirm` | API (GET) | Verifies email OTP (token_hash + type). |
| `/api/cron/cleanup` | API (GET) | Vercel Cron auto-deletion. Deletes documents >30 days (decrypts storagePath → deletes from Storage → CASCADE deletes analyses+clauses). Deletes rate_limits >7 days. Verifies `CRON_SECRET` via `timingSafeEqual`. `runtime = "nodejs"`, `maxDuration = 60`. |
| `/api/document/[id]` | API (GET) | Serve decrypted document binary. Owner-only (auth + userId check). Returns raw file bytes with appropriate Content-Type. `Cache-Control: private, max-age=3600`. `runtime = "nodejs"`. |
| `/admin` | Dynamic | Pipeline observability dashboard. Server component checks auth + `ADMIN_EMAIL` env var, redirects non-admins. `AdminDashboard` client component with `admin.dashboard` tRPC query. Stats cards, recent analyses table, error log. No NavBar link. |
| `/history` | Static | Analysis history page. Protected by middleware (redirects to `/login` if unauthenticated). `HistoryView` client component with infinite scroll via `analysis.list` tRPC query. |
| `/api/account/delete` | API (DELETE) | Delete user account. Deletes all documents + storage files + auth user. Returns `{ ok, docsDeleted, storageDeleted }`. |

## Components

### Landing page components
| Component | File | Notes |
|-----------|------|-------|
| `NavBar` | `nav-bar.tsx` | Dark bg, logo left, "How it works" smooth-scroll button + auth state right. Client component: `getUser()` + `onAuthStateChange`. Authenticated: dropdown menu (History link, Sign out, Delete account with ConfirmDialog). Unauthenticated: "Sign in" link. |
| `HeroSection` | `hero-section.tsx` | Dark bg, BackgroundPaths (pill shapes) + headline + SlidingWords + CTA button (smooth scroll to #upload) |
| `BackgroundPaths` | `background-paths.tsx` | Animated glassmorphism pill shapes in risk colors (motion library). `variant="hero"` (7 pills with risk labels like "Safe Clause ✓", "Penalty Clause") or `variant="auth"` (3 pills, no labels, subtler). ElegantPill subcomponent: entry animation + 12s floating loop. `prefers-reduced-motion` renders static. Used on hero, login, signup pages. |
| `ScrollReveal` | `scroll-reveal.tsx` | Intersection Observer wrapper using `useInView` from motion library. Fades children in (opacity 0→1, y 20→0) when scrolled into viewport. Props: `delay`, `once`, `direction`. `prefers-reduced-motion` renders plain div. |
| `SecuritySection` | `security-section.tsx` | 6 security feature cards in bento-grid layout (lg:3-col, md:2-col, 1-col mobile). Features: AES-256 encryption (col-span-2), auto-delete, no sharing, EU data center, anonymous analysis, per-document keys. Each card wrapped in ScrollReveal with staggered delay. |
| `TextShimmer` | `text-shimmer.tsx` | Gradient text animation (motion library). `prefers-reduced-motion` respected. |
| `UploadZone` | `upload-zone.tsx` | Native HTML5 drag-drop + file input. States: idle, drag-over, uploading (progress bar), processing (dots), error, rejection, rate-limit. Handles POST to `/api/upload`. Includes LanguageSelector below drop zone. |
| `LanguageSelector` | `language-selector.tsx` | Globe icon + native `<select>` with 15 languages (native names). Persists to `localStorage`. Defaults to `navigator.language`. Also exports `useResponseLanguage()` hook. |
| `SlidingWords` | `sliding-words.tsx` | Animated word carousel for hero headline. All words rendered simultaneously as absolute spans; active word slides to y:0/opacity:1, others to y:±150/opacity:0. Soft spring (stiffness:50). Container handles two-line text on mobile (`min-h-[2.6em]`). Respects `prefers-reduced-motion`. |
| `HowItWorks` | `how-it-works.tsx` | Client component. 3 steps with Lucide icons + ScrollReveal staggered animation. Horizontal on desktop, vertical on mobile. |
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
| `AnalysisView` | `analysis-view.tsx` | Client component. Dual-path: tRPC query for initial state, SSE subscription for streaming. `ProcessingSteps` shown before clauses arrive. Interaction model: `hoveredClause` (visual only, no scroll) + `pinnedClause` (click → scroll other panel with `block: "nearest"`). Scroll suppression via `isScrollingRef` (150ms debounce) prevents hover during scroll. Minimum 400ms shimmer per clause via `shimmerStartTimes` + `pendingResults` buffering — `analyzingPositions` is a `Set<number>`. Auto-scroll follows analysis progress (`skeletonRef`) until `userHasInteracted` (wheel/touchmove). Summary skeleton shown between last clause and summary arrival. `GreenClauseCompact` inline for green clauses. DB render path shows side-by-side layout. |
| `AnalysisActions` | `analysis-actions.tsx` | Props: `analysisId`, `isOwner`, `isPublic`, `shareExpiresAt`. Owner view: share toggle (enables 7-day link + copies URL), stop-sharing button (`Link2Off` icon), Download PDF, Delete (with ConfirmDialog). Non-owner view: copy link + Download PDF only. Shows "Shared · Expires {date}" when active. Uses `analysis.toggleShare` mutation. Centered below summary in both DB and streaming paths. |
| `ClauseCard` | `clause-card.tsx` | 4px left border (risk color), category tag, RiskBadge, collapsible clause text (line-clamp-3), explanation, collapsible safer alternative (green-50 bg, chevron). `compact` prop hides clause text (used in side-by-side layout). CSS fade-slide-in animation. |
| `ConnectingLines` | `connecting-lines.tsx` | Fixed SVG overlay with cubic bezier curves connecting clause highlights to analysis cards. Risk-colored (3px stroke, full opacity for red/yellow). `docScrollContainer` ref for accurate scroll tracking (attached to TextDocumentPanel's inner scrollable div). rAF-throttled updates. |
| `DocumentPanel` | `document-panel.tsx` | Dispatcher routing to `TextDocumentPanel`. Passes through `onScrollContainerRef`. Future: PDF viewer dispatch. Exports `ClauseHighlight` type. |
| `TextDocumentPanel` | `text-document-panel.tsx` | Block-level clause highlighting (full-width `<div>` blocks, not inline spans). Paragraph detection, alternating shade for same-risk clauses. Exposes scroll container via `onScrollContainerRef` callback. No auto-scroll on hover (click-to-scroll handled by parent). Risk colors, analyzing shimmer, pending gray, flash overlay. |
| `ProcessingSteps` | `processing-steps.tsx` | Animated step-by-step processing indicator (connecting → gate → extracting → parsing → analyzing). Active: spinning `Loader2` + shimmer text with staggered delay. Done: green `CheckCircle2`. "Analyzing" step shows dynamic clause count. |
| `StatusBar` | `status-bar.tsx` | Blue bar below nav. Pulsing dot indicator + status message text. `aria-live="polite"`. CSS-only, no animation library. |
| `ProgressBar` | `progress-bar.tsx` | Thin amber gradient bar with glow shadow showing determinate progress (X of N clauses). CSS transition on width. `role="progressbar"` with `aria-valuenow/min/max` and descriptive `aria-label`. |
| `RecommendationBadge` | `recommendation-badge.tsx` | Large pill: "Safe to Sign" (green) / "Proceed with Caution" (amber) / "Do Not Sign" (red). Uses `Recommendation` type. |
| `BreakdownBar` | `breakdown-bar.tsx` | Horizontal stacked bar (red|amber|green segments) with dot + count labels. Pure div widths, no charting library. |
| `SummaryPanel` | `summary-panel.tsx` | Composed: RiskScore + RecommendationBadge + BreakdownBar + top concerns list + contract type/language. Fade-in animation. |

### Admin page components
| Component | File | Notes |
|-----------|------|-------|
| `AdminDashboard` | `admin-dashboard.tsx` | Client component. `trpc.admin.dashboard.useQuery` with period selector (24h/7d/30d). Stats cards (total analyses, success rate, avg duration, estimated cost, token totals). Recent analyses table with per-step timing. Error log with step + message. Simple Tailwind tables, no charting library. |

### History page components
| Component | File | Notes |
|-----------|------|-------|
| `HistoryView` | `history-view.tsx` | Client component. `trpc.analysis.list.useInfiniteQuery` with cursor-based pagination. Renders list items with risk score, document name, contract type badge, recommendation badge, date. Delete button per item (with ConfirmDialog). Empty state for new users. Loading skeleton. "Load more" button for pagination. |
| `ConfirmDialog` | `confirm-dialog.tsx` | Reusable `<dialog>` modal. Props: `open`, `onClose`, `onConfirm`, `title`, `description`, `confirmLabel`, `loading`, `variant` (`"destructive"` | `"default"`). Used for analysis deletion and account deletion. Dark themed. |

## Upload Route (`POST /api/upload`)

Accepts PDF, DOCX, and TXT files. Order: **rate limit check** → MIME type (pdf/docx/txt) → file size (≤10MB) → type-specific extraction (PDF: magic bytes + unpdf + page count ≤30; DOCX: PK magic bytes + mammoth + char count ≤90k; TXT: UTF-8 decode + char count ≤90k) → empty text check → min text length (50 chars).

After validation: upload to Supabase Storage → create document record → run relevance gate → if contract: update document + create analysis record.

Rate limit uses `checkRateLimit(ip)` from `@redflag/api/rateLimit`. If DB fails, returns 503 (fail-closed — pipeline would fail anyway).

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
- `@supabase/ssr` — Auth session management: browser client, server client, middleware
- `@supabase/supabase-js` — Supabase Storage uploads (service role key), auth types
- `@redflag/agents` — Relevance gate (`relevanceGate`)
- `@redflag/api` — Rate limiting (`checkRateLimit` via `@redflag/api/rateLimit`)
- `@redflag/db` — Database inserts/updates (documents, analyses tables)
- `@redflag/shared` — Zod schemas, constants, `RiskLevel` type, `logger`

## Config

- `next.config.ts` — `transpilePackages` for all `@redflag/*` packages, `async headers()` with security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- `tsconfig.json` — `declaration: false` (web app doesn't emit .d.ts), `@/*` path alias for `./src/*`

## Rules

- No package may import from `@redflag/web` — dependency direction is one-way
- File upload uses a raw route handler, not tRPC (multipart/form-data)
- Mobile-first responsive design — design for 375px, scale up
- `motion` library used ONLY on landing page + auth pages (BackgroundPaths, SlidingWords, ScrollReveal, SecuritySection, HowItWorks). Analysis page is CSS-only.
- All animated components must respect `prefers-reduced-motion`
- Native HTML5 drag-drop for upload — no `react-dropzone`
