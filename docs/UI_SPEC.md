# Phase 6: UI Overhaul — Implementation Plan

## Context

The current RedFlag AI UI is functional but static, plain, and lacks the visual energy expected of an AI-powered product. Key problems:
- **Dead time everywhere**: gaps between upload completion and processing, between clause detection and analysis, etc.
- **Summary panel buried**: risk score sits below all clause cards — users must scroll through everything first
- **Analysis page is a vertical card stack**: no document context, no visual connection between clauses and their source text
- **Hero section has issues**: background paths too thin/harsh angles, text shimmer misused, harsh color transition to white
- **Auth pages disconnected**: bare white cards with no brand personality
- **Streaming too chunky**: whole clause analysis appears at once instead of streaming progressively

## Core Design Philosophy: Constant Stimulation

**There must never be a moment where the user sees nothing happening.** Every processing step — upload validation, clause detection, clause analysis, summary generation — must have continuous visual feedback: animations, streaming text, shimmer effects, status updates, thinking indicators.

**UI/UX Pro Max guidelines confirm this (severity: HIGH):**
- "Show spinner/skeleton for operations > 300ms" — any wait over 300ms needs visual feedback
- "Stream text response token by token" — never show a loading spinner for 10s+
- "Use skeleton screens or spinners" — leave no UI frozen with no feedback
- "Step indicators or progress bar" — show progress for multi-step processes

---

## Landing Page

### Hero Section

**Layout:** Full-viewport height, single consistent background color throughout the page (dark slate-950 or neutral-950 — no harsh white transition).

**Background Paths (redesigned):**
- **3-6 thick ribbons** (not 36 thin lines) — like highlighters or flags
- Colors: red, amber, green (the risk colors) at ~30-40% opacity
- **Smooth bezier curves** — no hard angles. Organic, flowing paths
- Stroke width: 40-80px (not 0.5-2px like current)
- **Extend through entire page** — not clipped at hero bottom. Ribbons flow from top through upload section and beyond
- Animate with slow, continuous motion (20-30s loops)
- `prefers-reduced-motion`: static, subtle gradient overlay instead

**Headline:**
```
Find the red flags in your
[rental contracts]     ← sliding words, cycling every 2.5s
```
- Large display text (6xl mobile, 8xl desktop)
- **Sliding words** cycle through: "rental contracts", "lease agreements", "NDAs", "freelance contracts", "employment agreements"
- Spring animation with vertical slide (from animated-hero reference)
- Words colored with a subtle gradient or the amber accent

**Subtitle:** Plain text, no shimmer (shimmer is reserved for AI-thinking states)

**CTA button:** "Upload your contract ↓" — scrolls to upload zone

### Upload Zone

**Integrated into the page flow** — not a separate white section. Sits within the same background with the ribbons flowing behind it.

**Design:** Inspired by 21st.dev file upload reference:
- Rounded container with subtle glassmorphism/frosted glass effect
- Drag-over state: blue ring glow, scale up, "Drop files here" with animated icon
- **Upload progress**: animated progress bar with spring physics
- **Post-upload processing**: immediately transition to a "Processing..." state:
  - File preview card (filename, size, type icon) stays visible
  - Animated spinner or thinking indicator
  - Text shimmer: "Checking document type..." → "Extracting text..." → "Running relevance check..."
  - **No dead time** — even if the backend is fast, show at least a brief animation

**Language selector:** Globe icon + styled select, integrated below or beside the upload zone.

### How It Works

- 3 steps with icons, positioned **below** the upload zone
- Horizontally on desktop, vertically on mobile
- Consider subtle scroll-reveal animations (fade up as they enter viewport)

### Footer / Legal Disclaimer

- Same as current but styled to match the dark background
- Privacy Policy + Terms of Service links

---

## Analysis Page — The Big Redesign

### Overall Layout (Desktop)

```
┌─────────────────────────────────────────────────────┐
│  NavBar                              [Share] [PDF]  │
├──────────────────────┬──────────────────────────────┤
│                      │                              │
│   Document Panel     │    Analysis Panel            │
│   (scrollable)       │    (scrollable, synced)      │
│                      │                              │
│   Rendered text      │    Summary (top, sticky?)    │
│   with highlighted   │    ─────────────────────     │
│   clauses            │    Clause 1 analysis card    │
│   ┌──────────┐       │    ┌────────────────────┐    │
│   │ Clause 1 │───────│───▶│ Risk + explanation │    │
│   └──────────┘       │    └────────────────────┘    │
│   ┌──────────┐       │    Clause 2 analysis card    │
│   │ Clause 2 │───────│───▶│ ...                │    │
│   └──────────┘       │    └────────────────────┘    │
│   ...                │    ...                       │
│                      │                              │
└──────────────────────┴──────────────────────────────┘
```

- **Left panel (50-55%):** Document text rendered in a clean, readable format. Each clause highlighted with background color. Alternating subtle shades for clause boundaries (even when all green). Clause numbers displayed.
- **Right panel (45-50%):** Summary panel at top (risk score, recommendation, breakdown). Below: clause analysis cards aligned to their corresponding highlighted text. Connecting lines from clause highlight to analysis card.
- **Scroll sync:** Both panels scroll together or semi-independently with the connecting lines maintaining alignment.

### Overall Layout (Mobile ≤768px)

Side-by-side doesn't work. **Tap-to-expand inline** approach:
- Single column with document text and clause highlights
- **Tapping a highlighted clause** expands its analysis card inline directly below the clause text
- Tapping again (or another clause) collapses it
- Summary panel at top (scrollable, not sticky)
- Red/yellow risk clauses auto-expand on load (consistent with desktop behavior)

### Streaming UX — Step by Step

This is the critical flow. Every moment must have visual feedback.

#### Step 1: Upload Complete → Redirect

After upload succeeds, redirect to `/analysis/[id]`. The page loads in "processing" state.

**What the user sees:**
- NavBar
- Processing indicator: animated thinking block (inspired by agent-plan reference)
  - Shimmer text: "Analyzing your contract..."
  - Steps appearing: "Checking document relevance..." ✓ → "Identifying clauses..."
  - Spinner or animated dots

#### Step 2: Document Text Appears

**New SSE event needed:** `document_text` — sends the full extracted text to the frontend immediately after the gate passes.

**What the user sees:**
- Left panel: Document text fades in, styled as a clean document
- Subtle shimmer overlay on the entire document: "Identifying clauses..."
- Right panel: skeleton/loading state

#### Step 3: Clauses Detected

**Existing SSE event:** `clause_positions` — already sends positions. We enhance it.

**What the user sees:**
- Document text gets clause highlights applied — alternating gray shades initially
- Each clause gets a number badge (①, ②, ③...)
- Brief stagger animation — clauses highlight one by one (fast, 50ms each)
- Right panel: skeleton cards appear for each clause (matching count)
- Status text updates: "Found N clauses. Analyzing..."

#### Step 4: Clause Analysis Streaming

**Current behavior:** Complete clause analysis arrives at once per clause.
**Enhanced behavior:** Each clause analysis card appears as its `report_clause` tool call completes. But during analysis:

**What the user sees for each clause being analyzed:**
- Left panel: the active clause's highlight **shimmers** (animated gradient overlay)
- Right panel: the corresponding card shows a thinking state:
  - Spinner + "Analyzing clause N..."
  - Text shimmer effect on placeholder text
- When complete:
  - Left panel: highlight transitions to final risk color (red/amber/green) with a brief flash animation
  - Right panel: analysis card content fades/slides in — risk badge, category, explanation
  - Connecting line draws from clause to card
  - For green (low risk) clauses: card is compact (1 line explanation)
  - For yellow/red (risky) clauses: full explanation + collapsible safer alternative

**Progress:** Determinate progress indicator: "Analyzed 3 of 12 clauses"

#### Step 5: Summary Appears

After all clauses analyzed, summary panel animates in at the top of the right panel:
- **Smooth scroll to top** — page scrolls up to reveal the summary
- Risk score gauge animates from 0 to final value
- Recommendation badge fades in
- Breakdown bar fills
- Top concerns list items stagger in
- Summary is at the top of the right panel, **not sticky** — it scrolls with content

#### Step 6: Complete State

- All clause highlights have final colors
- All analysis cards populated
- Summary visible at top right
- Share + Download PDF buttons appear
- Connecting lines visible on hover or always (need to decide)

### Connecting Lines

SVG-based lines drawn between clause highlights (left panel) and analysis cards (right panel):
- Thin lines (1-2px) in the clause's risk color (muted)
- **Red/yellow (risky) clauses:** Lines and expanded cards are **always visible** — risky clauses demand attention
- **Green (low risk) clauses:** Lines appear on **hover**, click to **pin** them visible
- Lines update position on scroll (use ResizeObserver + scroll listeners)

### Clause Interaction

**Hover on clause highlight (left panel):**
- Clause highlight intensifies
- Corresponding analysis card gets a glow/border highlight
- Connecting line appears (if not already visible)

**Click on clause highlight:**
- Analysis card scrolls into view on right panel (if not visible)
- Card expands to show full details
- Line persists (pinned)

**Hover on analysis card (right panel):**
- Corresponding clause highlight intensifies in document
- Line appears (if not already visible)

**Click on analysis card:**
- Scrolls the document panel to bring the clause into view
- Line persists (pinned)

### Document Panel Styling

- White/light background (paper-like) in a contained card/panel
- Clean typography (the body font, DM Sans)
- Comfortable line height and spacing
- Clause highlights: subtle background colors
  - Analyzing: animated shimmer (gray gradient sweep)
  - Green: `bg-green-100/60` with `border-l-2 border-green-500`
  - Yellow: `bg-amber-100/60` with `border-l-2 border-amber-500`
  - Red: `bg-red-100/60` with `border-l-2 border-red-500`
  - Between clauses: normal text (no highlight)
- Clause numbers: small badge in the left margin

---

## Auth Pages (Login / Signup)

- Same dark background as main page (consistency)
- Background paths visible behind the auth card (same ribbons, more subtle)
- Card: frosted glass effect, rounded, with the RedFlag AI logo
- Consistent with the rest of the product's visual language

---

## Design System (informed by UI/UX Pro Max skill)

**Style foundation:** Trust & Authority + Minimalism (recommended for Legal Services by UI/UX Pro Max). Blended with modern SaaS energy since this is an AI-powered product, not a traditional law firm.

### Color System

**Dark foundation, light content panels.** Authority navy + trust gold — the industry-validated palette for legal tech.

| Token | Light Value | Dark Value | Usage |
|-------|-------------|------------|-------|
| Background | `#F8FAFC` | `#0B1120` | Page bg (dark used for hero, nav, auth) |
| Surface | `#FFFFFF` | `#131B2E` | Document panel, cards, upload zone |
| Surface glass | `white/80 blur` | `white/5 blur` | Frosted overlays |
| Primary | `#1E3A8A` | `#3B82F6` | Trust navy / links, interactive |
| Accent / CTA | `#F59E0B` | `#F59E0B` | Gold — authority, action (CTAs, progress) |
| Text primary | `#0F172A` | `#F1F5F9` | Body text |
| Text secondary | `#64748B` | `#94A3B8` | Muted text |
| Border | `#E2E8F0` | `#1E293B` | Dividers, card borders |
| Ring / focus | `#2563EB` | `#3B82F6` | Focus states, interactive |
| Risk red | `#DC2626` | `#EF4444` | High risk |
| Risk amber | `#D97706` | `#F59E0B` | Caution |
| Risk green | `#16A34A` | `#22C55E` | Low risk / safe |
| Destructive | `#DC2626` | `#EF4444` | Error states |

**Key from UI/UX Pro Max:** "Authority navy + trust gold" palette. CTA uses amber/gold (#F59E0B) — not blue. Blue is for trust/links, gold is for action.

### Typography

Keep current fonts — confirmed as strong by UI/UX Pro Max searches:

| Role | Font | Weights | Notes |
|------|------|---------|-------|
| Headings | **Space Grotesk** | 500, 600, 700 | Geometric, modern, distinctive. UI/UX Pro Max: "geometric modern" category. |
| Body | **DM Sans** | 400, 500, 600 | Humanist, highly readable. Good contrast with geometric headings. |
| Mono (optional) | **JetBrains Mono** | 400 | For clause numbers, stats, code-like data. Consider adding. |

### Pre-Delivery Checklist (from UI/UX Pro Max)

- [ ] No emojis as icons — use Lucide SVGs (already in place)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Text contrast 4.5:1 minimum (WCAG AA), aim for 7:1 (AAA) on critical text
- [ ] Focus states visible for keyboard navigation (3-4px ring)
- [ ] `prefers-reduced-motion` respected on ALL animations
- [ ] Responsive breakpoints: 375px, 768px, 1024px, 1280px
- [ ] Touch targets ≥ 44x44px on mobile
- [ ] Avoid AI purple/pink gradients (anti-pattern for legal services per UI/UX Pro Max)

---

## Animation System

| Animation | Where | Implementation |
|-----------|-------|---------------|
| Background paths (ribbons) | Hero, auth pages | `motion` — thick SVG paths, slow continuous loop |
| Sliding words | Hero headline | `motion` — spring vertical slide, 2.5s interval |
| Text shimmer | Processing states, thinking indicators | `motion` — gradient sweep (from reference) |
| Upload progress | Upload zone | CSS transition + spring physics |
| Processing steps | Post-upload, pre-analysis | Staggered fade-in, checkmarks, spinners |
| Clause highlight shimmer | Active clause being analyzed | CSS animation — gradient sweep on background |
| Clause color transition | When analysis completes | CSS transition (300ms ease) |
| Card content reveal | Analysis card population | `motion` — fade + slide up |
| Risk score gauge | Summary panel | CSS animation — stroke-dasharray |
| Line drawing | Connecting lines | SVG path animation |
| Scroll-reveal | How it works, page sections | Intersection Observer + fade up |

All animations: `prefers-reduced-motion` → instant/static fallback.

---

## New SSE Events Needed

| Event | When | Payload | Purpose |
|-------|------|---------|---------|
| `document_text` | After gate passes | `{ text: string }` | Frontend renders document in left panel |
| `clause_analyzing` | Before each clause analysis | `{ clauseIndex: number }` | Trigger shimmer on active clause |

The existing `clause_positions`, `clause_analysis`, `summary`, `status` events are sufficient for the rest.

---

## Files to Modify

### New Components
- `apps/web/src/components/document-panel.tsx` — Rendered document with clause highlights
- `apps/web/src/components/analysis-sidebar.tsx` — Right panel with summary + clause cards
- `apps/web/src/components/connecting-lines.tsx` — SVG lines between panels
- `apps/web/src/components/processing-steps.tsx` — Post-upload processing animation
- `apps/web/src/components/sliding-words.tsx` — Hero animated text

### Modified Components
- `apps/web/src/components/hero-section.tsx` — Complete redesign
- `apps/web/src/components/background-paths.tsx` — Thick ribbons, fewer paths
- `apps/web/src/components/upload-zone.tsx` — Polished with preview + processing states
- `apps/web/src/components/analysis-view.tsx` — Side-by-side layout, new streaming UX
- `apps/web/src/components/clause-card.tsx` — Adapt for sidebar context
- `apps/web/src/components/summary-panel.tsx` — Move to top of right panel
- `apps/web/src/components/nav-bar.tsx` — Consistent with dark theme
- `apps/web/src/components/status-bar.tsx` — Integrated into processing flow
- `apps/web/src/components/text-shimmer.tsx` — Update to motion-primitives version
- `apps/web/app/globals.css` — New animations, color tokens
- `apps/web/app/login/page.tsx` — Redesign with brand consistency
- `apps/web/app/signup/page.tsx` — Same treatment

### Backend Changes
- `packages/agents/src/orchestrator.ts` — Emit `document_text` and `clause_analyzing` events
- `packages/api/src/routers/analysis.ts` — Forward new events in SSE stream
- `packages/shared/src/schemas/events.ts` — Add new event schemas

---

## Implementation Order

1. **Global: color system, backgrounds, nav** — Set the dark theme foundation
2. **Hero section** — Sliding words + redesigned background paths
3. **Upload zone** — Polished design + processing states
4. **Auth pages** — Match new design language
5. **Backend: new SSE events** — `document_text`, `clause_analyzing`
6. **Analysis page: document panel** — Render text with clause highlights
7. **Analysis page: analysis sidebar** — Summary at top + clause cards
8. **Analysis page: connecting lines** — SVG connectors
9. **Analysis page: streaming UX** — Shimmer, transitions, progress
10. **Mobile responsive** — Stacked layout fallback
11. **Polish + QA** — Full Playwright screenshot pass, reduced-motion, flow test

---

## Verification

1. `pnpm turbo lint type-check test build` — must pass
2. Playwright screenshots at 375px + 1280px for every page and state
3. Complete user flow test: land → upload → stream → results → share → download PDF
4. `prefers-reduced-motion` check on all animations
5. Auth flow: login → home → upload → analysis (with auth context)
6. Reconnect scenario: refresh during streaming → resumes correctly
