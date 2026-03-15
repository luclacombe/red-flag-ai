# Analysis Page (`/analysis/[id]`) — Design Overrides

> Overrides `MASTER.md` where specified. Unmentioned rules inherit from Master.

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  NAV BAR (dark, slate-900)                  │
│  Logo (links to /) · Contract type badge    │
├─────────────────────────────────────────────┤
│                                             │
│  STATUS BAR (full width, subtle)            │
│  "Parsing contract..." / "Analyzing..."     │
│  Disappears when analysis complete          │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  CLAUSE CARDS (vertical stack)              │
│  max-w-3xl, centered                        │
│                                             │
│  ┌──┬────────────────────────────────┐      │
│  │▌ │ Clause 1                       │      │
│  │R │ "The tenant shall forfeit..."  │      │
│  │E │ [Risk Badge: High Risk]        │      │
│  │D │ Explanation text...            │      │
│  │  │ ▸ View safer alternative       │      │
│  └──┴────────────────────────────────┘      │
│                                             │
│  ┌──┬────────────────────────────────┐      │
│  │▌ │ Clause 2                       │      │
│  │Y │ "Non-compete applies to..."    │      │
│  │E │ [Risk Badge: Caution]          │      │
│  │L │ Explanation text...            │      │
│  │  │ ▸ View safer alternative       │      │
│  └──┴────────────────────────────────┘      │
│                                             │
│  ┌──┬────────────────────────────────┐      │
│  │▌ │ Clause 3                       │      │
│  │G │ "Payment due within 30..."     │      │
│  │R │ [Risk Badge: Low Risk]         │      │
│  │N │ Standard payment terms.        │      │
│  └──┴────────────────────────────────┘      │
│                                             │
│  [Skeleton cards while streaming...]        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  SUMMARY PANEL (appears last)               │
│  ┌──────────────────────────────────┐       │
│  │                                  │       │
│  │  ┌─────┐  Overall Risk: 72/100  │       │
│  │  │ 72  │  [Do Not Sign]         │       │
│  │  └─────┘                         │       │
│  │                                  │       │
│  │  Breakdown: 3 red · 5 yellow · 8 │       │
│  │                                  │       │
│  │  Top Concerns:                   │       │
│  │  • Unlimited liability clause    │       │
│  │  • Non-compete overly broad      │       │
│  │  • Auto-renewal with no exit     │       │
│  │                                  │       │
│  └──────────────────────────────────┘       │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  LEGAL DISCLAIMER (persistent)              │
│  "This is not legal advice..."              │
│                                             │
└─────────────────────────────────────────────┘
```

## Page States

### 1. Streaming (pending/processing)

- Status bar at top: current pipeline step message
- Clause cards appear one by one with stagger animation
- Skeleton cards show for upcoming clauses (2-3 skeletons visible)
- Skeleton shape: matches ClauseCard (left border placeholder + 3 text lines)
- Summary panel area: empty until all clauses done

### 2. Complete (loaded from DB)

- No status bar
- All clause cards rendered immediately (no animation on refresh)
- Summary panel visible
- Legal disclaimer visible

### 3. Failed

- Status bar shows error message in red
- Any clauses that were persisted before failure: show them
- Error card at bottom: "Analysis could not be completed" + what went wrong
- "Try again" button → re-upload flow

### 4. Not Found (404)

- Simple centered message: "Analysis not found"
- Link back to home page

### 5. All Green (edge case)

- Summary panel shows positive message: "No significant risks found"
- Recommendation: "Safe to Sign"
- Score gauge: green, low number
- Still show all green clause cards (user wants to see what was analyzed)

## Clause Card Component

```
┌─[4px colored left border]──────────────────┐
│                                            │
│  Category tag         [Risk Badge: pill]   │
│                                            │
│  "Clause text goes here, showing the       │
│   actual contract language that was         │
│   analyzed by the AI..."                   │
│   [Show more] (if > 3 lines)              │
│                                            │
│  Explanation                               │
│  "This clause is problematic because..."   │
│                                            │
│  ▸ Safer alternative  (expandable,         │
│     only for red/yellow clauses)           │
│                                            │
└────────────────────────────────────────────┘
```

- **Category tag:** `text-xs font-medium text-slate-500 uppercase tracking-wide`
- **Clause text:** `text-sm text-slate-700 font-mono` (monospace to look like contract text)
- **Explanation:** `text-sm text-slate-600`
- **Safer alternative:** Collapsible section. Green-tinted background (`bg-green-50`) when expanded.
  Uses a chevron toggle. Alternative text in `text-sm text-green-800`.

## Summary Panel Component

- Background: `bg-white border border-slate-200 rounded-lg`
- Top section: Risk score gauge (SVG circle) + recommendation badge side by side
- Score gauge: SVG circular progress, color matches risk level
  - 0-33: green
  - 34-66: amber
  - 67-100: red
  - Animated count-up (800ms ease-out)
- Recommendation badge: Large pill
  - "Safe to Sign" → `bg-green-100 text-green-800 border-green-300`
  - "Proceed with Caution" → `bg-amber-100 text-amber-800 border-amber-300`
  - "Do Not Sign" → `bg-red-100 text-red-800 border-red-300`
- Clause breakdown bar: Horizontal stacked bar (red | yellow | green segments)
  - Shows counts: "3 high risk · 5 caution · 8 low risk"
- Top concerns: Bulleted list, `text-sm text-slate-700`

## Status Bar

- Position: below nav, full-width
- Background: `bg-blue-50 border-b border-blue-200`
- Text: `text-sm text-blue-700` wrapped in `TextShimmer` component (slow shimmer, ~3s duration)
- The shimmer effect communicates "processing" without a spinner — subtle, professional
- Messages cycle: "Parsing contract..." → "Found 16 clauses. Analyzing..." → "Generating summary..."
- Fades out when complete
- Fallback (prefers-reduced-motion): static text with a pulsing dot indicator instead of shimmer

## Loading Skeletons

- Match ClauseCard shape exactly
- Left border: `bg-slate-200` (neutral, no risk color)
- Content area: 3 rectangular pulse bars of varying width
- `animate-pulse` from Tailwind
- Show 2-3 skeletons below the last real card
