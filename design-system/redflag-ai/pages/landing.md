# Landing Page (`/`) — Design Overrides

> Overrides `MASTER.md` where specified. Unmentioned rules inherit from Master.

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  NAV BAR (dark, slate-900)                  │
│  Logo left · "How it works" anchor right    │
├─────────────────────────────────────────────┤
│                                             │
│  HERO SECTION (dark bg, slate-900)          │
│  ─────────────────────────────────          │
│  Bold headline (Space Grotesk 700)          │
│  Subheadline (DM Sans, slate-300)           │
│  [Upload your contract ↓] anchor button     │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  UPLOAD SECTION (light bg, slate-50)        │
│  ─────────────────────────────────          │
│  Section heading: "Analyze your contract"   │
│  ┌─────────────────────────────────┐        │
│  │   UPLOAD ZONE (dashed border)   │        │
│  │   Upload icon (Lucide)          │        │
│  │   "Drop your PDF here"          │        │
│  │   "or click to browse"          │        │
│  │   "PDF only · Max 10MB · ≤30p"  │        │
│  └─────────────────────────────────┘        │
│                                             │
│  Upload states:                             │
│  · Idle: dashed slate-300 border            │
│  · Drag over: amber-500 border, amber bg    │
│  · Uploading: progress bar, disabled zone   │
│  · Error: red border, error message below   │
│  · Rejected: inline message with reason     │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  HOW IT WORKS (white bg)                    │
│  ─────────────────────────────────          │
│  3 steps, horizontal on desktop,            │
│  vertical stack on mobile                   │
│                                             │
│  [1]          [2]          [3]              │
│  Upload       AI scans     Get results      │
│  your PDF     each clause  with rewrites    │
│                                             │
│  Each step: Lucide icon (48px) + heading    │
│  + one-line description. Numbered.          │
│  No cards — just icon + text, clean.        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  FOOTER (slate-100 bg)                      │
│  Legal disclaimer text                      │
│  "RedFlag AI does not provide legal advice" │
│                                             │
└─────────────────────────────────────────────┘
```

## Hero Override

- Background: `bg-slate-900` (dark) with `BackgroundPaths` component behind content
- **BackgroundPaths:** Animated SVG flowing ribbons in risk colors
  - 12-18 curved paths (fewer than the 36 in the original)
  - Stroke width: 2-4px (thicker than original's 0.5px)
  - Colors: red-500, amber-500, green-500 at ~10-15% opacity
  - Animation: slow continuous flow (20-30s loop, linear easing)
  - `pointer-events-none`, sits behind all content
  - Respects `prefers-reduced-motion` (static paths, no animation)
- Headline: `text-4xl md:text-5xl font-bold text-white` (Space Grotesk 700)
- Subheadline: `text-lg md:text-xl text-slate-300` (DM Sans 400) — optionally wrapped in `TextShimmer` for subtle polish
- CTA button: `bg-amber-500 text-slate-900 font-semibold` — anchors to upload section
- The bold typography + flowing risk-colored ribbons ARE the visual element
- No stock images, no illustrations

## Hero Copy Direction

- Headline should communicate: "Find the risks in your contract before you sign"
- Subheadline: one sentence explaining AI clause-by-clause analysis
- Keep it factual, not hyperbolic. No "revolutionary" or "powered by AI magic"

## Upload Zone Behavior

1. File dropped/selected → show filename + size, progress bar fills
2. Upload completes → gate runs → `ProcessingLoader` (bouncing dots) with "Checking document..."
3. If contract: navigate to `/analysis/[id]`
4. If not contract: show rejection message inline below the zone (red text, Lucide AlertCircle icon)
5. If error: show error message with "Try again" action
6. Rate limit hit: show friendly message with reset time (Clock icon + "You can try again at midnight UTC")

## Nav Bar

- Sticky on scroll? No — keep it simple for MVP
- Dark background (`slate-900`)
- Logo: "RedFlag AI" text in Space Grotesk 600, white
- Right: single text link "How it works" (scrolls to section)
- Mobile: same layout, no hamburger needed (only 1 nav link)
