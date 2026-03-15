# RedFlag AI — UI Specification

> Companion to `BUILD_PLAN.md` phases 4 + 5. This document defines what to build.
> Design tokens and rules: `design-system/redflag-ai/MASTER.md`
> Page-specific overrides: `design-system/redflag-ai/pages/`

## How to Use This Spec

This spec is **guidance, not gospel.** During implementation:

1. **Use the UI/UX Pro Max skill** — run `--domain ux`, `--domain style`, etc. for specific decisions. The skill script lives at `.claude/skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/scripts/search.py`.
2. **Use the Magic MCP** (`mcp__magic__21st_magic_component_inspiration` / `mcp__magic__21st_magic_component_builder`) when you need component ideas or want to search 21st.dev.
3. **Fetch 21st.dev component code** — URLs are provided below. Fetch the actual source code via WebFetch, then adapt it. Do NOT guess or recreate from memory/descriptions.
4. **Modify the spec** if something doesn't work in practice — update this file and the page override files when you deviate. Keep them as the source of truth for what was actually built.
5. **Run the pre-delivery checklist** in `MASTER.md` before considering UI work done.

---

## Design Direction

**Bold + Warm.** Protective, confident, not vibe-coded.

- **Style:** Flat Design base. Bold Typography on the hero. No gradients, no glassmorphism.
- **Color:** Hybrid dark/light. Dark nav + hero (slate-900), light content (slate-50).
- **Typography:** Space Grotesk (headings) + DM Sans (body). Technical authority + human warmth.
- **Accent:** Amber/gold for CTAs and positive actions. Red reserved ONLY for risk indicators.
- **Animations:** Functional only. Card stagger entrance, score count-up, fade transitions. No springs or bouncing on content. One bold moment: animated background paths on hero.
- **Hero accent:** Animated flowing SVG ribbons in risk colors (red/amber/green) — geometric, on-brand, distinctive.

---

## Fonts Setup

Install via `next/font/google` (not CSS import — better performance):

```typescript
// apps/web/app/fonts.ts
import { Space_Grotesk, DM_Sans } from 'next/font/google'

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-heading',
  weight: ['500', '600', '700'],
})

export const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600'],
})
```

Wire into Tailwind v4 via CSS variables in `app/globals.css`:
```css
@theme {
  --font-heading: var(--font-heading);
  --font-body: var(--font-body);
}
```

---

## Components Inventory

### Phase 4 Components (Landing + Upload)

| Component | Source | Notes |
|-----------|--------|-------|
| `NavBar` | Custom | Dark bg, logo text, minimal. No hamburger needed. |
| `BackgroundPaths` | Adapted from 21st.dev `kokonutd/background-paths` | Thick, translucent flowing SVG ribbons in red/amber/green. Hero background only. Modified: fewer paths (~12-18), thicker strokes (2-4px), risk colors with low opacity. |
| `HeroSection` | Custom | Dark bg, BackgroundPaths behind, bold Space Grotesk headline, CTA anchors to upload. |
| `TextShimmer` | Adapted from 21st.dev `motion-primitives/text-shimmer` | Subtle shimmer on hero subheadline or status bar text. Adds polish without being flashy. |
| `UploadZone` | Custom (native HTML5) | Drag-drop + file input. NO react-dropzone. |
| `UploadProgress` | Custom | Filename, size, progress bar during upload. |
| `ProcessingLoader` | Adapted from 21st.dev `erikx/loader` (dots variant) | Bouncing dots shown during gate check after upload. "Checking document..." |
| `UploadError` | Custom | Inline error message below zone with retry. |
| `HowItWorks` | Custom | 3 steps with Lucide icons. Numbered. |
| `LegalDisclaimer` | Custom | Footer text. Not dismissable. |
| `RiskBadge` | Adapted from 21st.dev `arihantcodes/status-badge` | Lucide icon + colored bg pill. 3 risk variants: red (AlertTriangle), yellow (TriangleAlert), green (CircleCheck). |

### Phase 5 Components (Results + Polish)

| Component | Source | Notes |
|-----------|--------|-------|
| `ClauseCard` | Custom | 4px left border, collapsible text, expandable rewrite. |
| `ClauseSkeleton` | Custom | Pulse animation matching ClauseCard shape. |
| `StatusBar` | Custom | Blue bar below nav showing pipeline step. |
| `RiskScore` | Adapted from 21st.dev `magicui/animated-circular-progress-bar` | SVG circular gauge. CSS-driven animation (no motion library). Color shifts by score range: 0-33 green, 34-66 amber, 67-100 red. Animated count-up on appearance. |
| `RecommendationBadge` | Custom | Large pill: "Safe to Sign" / "Caution" / "Do Not Sign". |
| `BreakdownBar` | Custom | Horizontal stacked bar showing red/yellow/green counts. |
| `SummaryPanel` | Custom | Composed: RiskScore + RecommendationBadge + BreakdownBar + concerns list. |
| `ErrorState` | Custom | Friendly error display with retry CTA. |
| `NotFoundState` | Custom | Simple "not found" with home link. |

### shadcn/ui Components to Install

```bash
npx shadcn@latest add badge button card collapsible separator skeleton
```

These provide the accessible primitives. All styling overridden via Tailwind to match our design system.

---

## Page Specifications

### Landing Page (`/`)

See: `design-system/redflag-ai/pages/landing.md` for full layout.

**Section order:**
1. Nav bar (dark)
2. Hero (dark bg, bold headline, CTA button)
3. Upload zone (light bg, dashed border, drag-drop)
4. How it works (3 steps with icons)
5. Footer with legal disclaimer

**Key interactions:**
- Upload CTA in hero anchors smoothly to upload section
- Upload zone handles: drag-over, file validation, upload progress, gate result
- Rejection shows inline (not a modal) with the reason from the gate agent
- Success navigates to `/analysis/[id]` via `router.push()`
- Rate limit shows friendly message with when they can try again

**Mobile (375px):**
- Hero: stack vertically, reduce headline to `text-3xl`
- Upload zone: full-width with less padding
- How it works: vertical stack (not 3-column grid)

### Analysis Page (`/analysis/[id]`)

See: `design-system/redflag-ai/pages/analysis.md` for full layout.

**Dual-path rendering:**
1. If status is `complete` → load from DB, render all cards immediately
2. If status is `pending`/`processing` → subscribe to SSE, stream cards

**Section order:**
1. Nav bar (dark, with contract type badge)
2. Status bar (blue, shows pipeline step — only during streaming)
3. Clause cards (vertical stack, max-w-3xl, centered)
4. Loading skeletons (during streaming, below last real card)
5. Summary panel (appears after all clauses)
6. Legal disclaimer (persistent at bottom)

**Streaming UX:**
- Each clause card fades in + slides up (200ms, 30ms stagger)
- 2-3 skeleton cards visible below the last rendered card
- Status bar text updates with each pipeline stage
- Summary panel fades in as the final element
- Score gauge animates count-up when summary appears

**Key interactions:**
- Clause text is collapsible if > 3 lines (show "Show more" toggle)
- Safer alternative is in a collapsible section (chevron toggle)
- On page refresh after completion: render from DB, no animation

---

## Streaming Animation Spec

```
Time 0s     Status bar: "Parsing contract..."
Time ~3s    Status bar: "Found 16 clauses. Analyzing..."
Time ~4s    Card 1 fades in (200ms ease-out)
Time ~4.03s Card skeleton 1 visible below
Time ~6s    Card 2 fades in, skeleton shifts down
...
Time ~45s   Last card fades in
Time ~46s   Status bar: "Generating summary..."
Time ~48s   Summary panel fades in, gauge animates 0→72
Time ~49s   Status bar fades out
```

Skeletons: always show 2-3 below the last real card. As new cards arrive, the top skeleton gets replaced, and a new one appears at the bottom. When the last card arrives, all skeletons fade out.

---

## Risk Color Mapping

Used consistently everywhere — badges, card borders, gauge, breakdown bar:

| Risk Level | Label | Border | Badge BG | Badge Text | Badge Border |
|------------|-------|--------|----------|------------|--------------|
| `red` | "High Risk" | `border-l-red-600` | `bg-red-50` | `text-red-700` | `border-red-200` |
| `yellow` | "Caution" | `border-l-amber-600` | `bg-amber-50` | `text-amber-700` | `border-amber-200` |
| `green` | "Low Risk" | `border-l-green-600` | `bg-green-50` | `text-green-700` | `border-green-200` |

---

## 21st.dev Component References

**IMPORTANT:** Do NOT guess or recreate this code from descriptions. Fetch the actual source from the URL, then modify it.

### How to fetch

Use `WebFetch` on each URL to get the component code, then adapt it to our design system. The URLs return component source code in markdown format.

### Components

#### 1. BackgroundPaths (Hero background)
- **URL:** `https://21st.dev/community/components/kokonutd/background-paths/default`
- **Use in:** `HeroSection` on landing page
- **Modifications needed:**
  - Reduce paths from 36 to ~12-18 (performance)
  - Increase stroke width from 0.5px to 2-4px (thicker ribbons)
  - Replace `currentColor` strokes with risk colors: `rgba(220,38,38,0.12)` (red), `rgba(245,158,11,0.12)` (amber), `rgba(22,163,74,0.12)` (green)
  - Remove the spring letter animation on the title (we do our own headline)
  - Remove the glassmorphic button (we do our own CTA)
  - Add `prefers-reduced-motion` check — show static paths when motion is reduced
  - Keep the `FloatingPaths` SVG animation logic, discard the rest

#### 2. TextShimmer (Status bar text)
- **URL:** `https://21st.dev/community/components/motion-primitives/text-shimmer/default`
- **Use in:** `StatusBar` on analysis page during streaming
- **Modifications needed:**
  - Slow duration to ~3s (less flashy)
  - Set colors to match our blue status bar (`--base-color: slate-400`, `--base-gradient-color: blue-800`)
  - Add `prefers-reduced-motion` check — render plain text when motion is reduced

#### 3. Animated Circular Progress Bar (Risk score gauge)
- **URL:** `https://21st.dev/magicui/animated-circular-progress-bar/default`
- **Use in:** `RiskScore` in `SummaryPanel` on analysis page
- **Modifications needed:**
  - Dynamic `gaugePrimaryColor` based on score range: 0-33 green-600, 34-66 amber-600, 67-100 red-600
  - `gaugeSecondaryColor`: `slate-200`
  - Size: 120px
  - Show score number centered inside
  - CSS-only animation (no `motion` dependency — this component uses CSS transitions natively)

#### 4. Status Badge (Risk badges)
- **URL:** `https://21st.dev/arihantcodes_1f7b8c4d/status-badge/default`
- **Use in:** `RiskBadge` throughout analysis page
- **Modifications needed:**
  - Map to 3 risk levels only: High Risk (red, AlertTriangle icon), Caution (amber, TriangleAlert icon), Low Risk (green, CircleCheck icon)
  - Use our risk color tokens from MASTER.md (bg-red-50 + text-red-700 etc.)
  - Change shape from `rounded-xl` to `rounded-full` for inline pill style
  - Reduce width from fixed `w-40` to auto-width `px-3 py-1`

#### 5. Loader (Processing dots)
- **URL:** `https://21st.dev/erikx/loader/default`
- **Use in:** Upload zone during gate check ("Checking document...")
- **Modifications needed:**
  - Use only the dots/typing variant — ignore other 11 variants
  - Match our color tokens (amber-500 dots on light background)
  - Keep it pure CSS (no motion library)
  - Small size, inline with "Checking document..." text

---

## Dependencies

### Required for UI phases

```bash
# In apps/web
pnpm add motion    # Lightweight successor to framer-motion (~15KB). Used for BackgroundPaths + TextShimmer on landing page ONLY.
```

### NOT to use

- `react-dropzone` — native HTML5 drag-drop is ~30 lines
- `framer-motion` — use `motion` instead (lighter, same API)
- `chart.js` or `recharts` — the breakdown bar and gauge are simple SVG, no charting library needed
- Any component that adds glassmorphism or blur effects
- Dark mode toggle — single theme for MVP

### Scope of `motion` usage

`motion` is used ONLY in two landing page components:
1. `BackgroundPaths` — animated SVG path drawing
2. `TextShimmer` — subtle gradient text animation

The analysis page uses CSS animations only (`animate-pulse` for skeletons, CSS transitions for card entrance, CSS `@keyframes` for gauge count-up). This keeps the analysis page fast and dependency-light.

---

## Accessibility Checklist (from UI/UX Pro Max)

### Critical (must have)
- [ ] Color contrast ≥ 4.5:1 for all text
- [ ] Risk information conveyed by icon + text, not color alone
- [ ] Focus rings visible on all interactive elements
- [ ] Keyboard navigation works: tab through upload zone, cards, toggles
- [ ] `aria-live` region for status bar messages (screen reader announces pipeline progress)
- [ ] `aria-expanded` on collapsible clause text and safer alternative sections
- [ ] Upload zone: `role="button"` with keyboard activation (Enter/Space)
- [ ] Skip link to main content

### High (should have)
- [ ] `prefers-reduced-motion`: disable card stagger animation, score count-up
- [ ] Min touch target 44x44px on all interactive elements
- [ ] Error messages associated with upload zone via `aria-describedby`
- [ ] Heading hierarchy: h1 (page title) → h2 (sections) → h3 (card titles)

---

## Visual QA Plan (Phase 5)

Use Playwright MCP to screenshot every state:

1. Landing — desktop (1440px)
2. Landing — mobile (375px)
3. Landing — upload drag-over state
4. Landing — upload error state (wrong file type)
5. Landing — upload rejection (not a contract)
6. Analysis — streaming in progress (3 cards + skeletons)
7. Analysis — complete with mixed red/yellow/green
8. Analysis — all green clauses
9. Analysis — error state (pipeline failed)
10. Analysis — 404 not found

Review each screenshot against MASTER.md checklist before shipping.
