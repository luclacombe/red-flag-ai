# RedFlag AI — Design System

> **Hierarchy:** Page-specific files in `pages/` override this file.
> If no page file exists, follow these rules strictly.

**Project:** RedFlag AI
**Direction:** Bold + Warm — protective, confident, not vibe-coded
**Style Base:** Flat Design with Bold Typography hero moments

---

## Color Palette

Hybrid dark/light. Dark nav + hero for boldness, light content for readability.

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| **Navy (dark bg)** | `#0F172A` | `slate-900` | Nav bar, hero section background |
| **Content bg** | `#F8FAFC` | `slate-50` | Main content area, page background |
| **Card bg** | `#FFFFFF` | `white` | Cards, panels |
| **Primary** | `#2563EB` | `blue-600` | Links, interactive elements, focus rings |
| **CTA / Accent** | `#F59E0B` | `amber-500` | Primary buttons, upload CTA, positive indicators |
| **Text (on light)** | `#0F172A` | `slate-900` | Body text on light backgrounds |
| **Text (on dark)** | `#F8FAFC` | `slate-50` | Text on navy backgrounds |
| **Muted text** | `#64748B` | `slate-500` | Secondary text, captions |
| **Border** | `#E2E8F0` | `slate-200` | Card borders, dividers |
| **Risk Red** | `#DC2626` | `red-600` | Red risk badges, clause borders |
| **Risk Red bg** | `#FEF2F2` | `red-50` | Red badge background tint |
| **Risk Yellow** | `#D97706` | `amber-700` | Yellow risk badges, clause borders |
| **Risk Yellow bg** | `#FFFBEB` | `amber-50` | Yellow badge background tint |
| **Risk Green** | `#16A34A` | `green-600` | Green risk badges, clause borders |
| **Risk Green bg** | `#F0FDF4` | `green-50` | Green badge background tint |
| **Destructive** | `#DC2626` | `red-600` | Error states, destructive actions |

**Rules:**
- Red is NEVER the brand color — it's reserved for risk indicators
- Amber/gold is the warm accent — CTAs, positive states, highlights
- Navy is used sparingly — nav bar and hero only, not entire pages
- Content areas are always light for readability of legal text

---

## Typography

| Role | Font | Weights | Tailwind Config |
|------|------|---------|-----------------|
| **Headings** | Space Grotesk | 500, 600, 700 | `fontFamily: { heading: ['Space Grotesk', 'sans-serif'] }` |
| **Body** | DM Sans | 400, 500, 600 | `fontFamily: { body: ['DM Sans', 'sans-serif'] }` |

**Google Fonts:**
```
https://fonts.google.com/share?selection.family=DM+Sans:wght@400;500;600;700&Space+Grotesk:wght@400;500;600;700
```

**Type Scale:**

| Element | Size | Weight | Line Height | Font |
|---------|------|--------|-------------|------|
| Hero headline | `text-4xl` / `md:text-5xl` | 700 | 1.1 | Space Grotesk |
| Page title | `text-2xl` / `md:text-3xl` | 600 | 1.2 | Space Grotesk |
| Section heading | `text-xl` | 600 | 1.3 | Space Grotesk |
| Card title | `text-lg` | 600 | 1.3 | Space Grotesk |
| Body text | `text-base` (16px) | 400 | 1.6 | DM Sans |
| Small text | `text-sm` (14px) | 400 | 1.5 | DM Sans |
| Caption / label | `text-xs` (12px) | 500 | 1.4 | DM Sans |
| Badge text | `text-xs` (12px) | 600 | 1 | DM Sans |

**Why this pairing:**
- Space Grotesk: geometric, technical, unique character — gives headlines authority
- DM Sans: humanist, highly readable, slightly rounded — warmth for body text
- Together: bold + warm without being trendy

---

## Spacing

8px grid system. All spacing is multiples of 8.

| Token | Value | Usage |
|-------|-------|-------|
| `gap-1` | 4px | Inline icon gaps |
| `gap-2` | 8px | Badge padding, tight spacing |
| `p-4` | 16px | Card padding (mobile) |
| `p-6` | 24px | Card padding (desktop), section gaps |
| `gap-6` | 24px | Between cards in a list |
| `py-12` | 48px | Section vertical padding |
| `py-16` | 64px | Hero vertical padding |
| `max-w-3xl` | 768px | Content max-width (keeps text readable) |

---

## Component Design Tokens

### Cards
- Background: `white`
- Border: `1px solid slate-200`
- Radius: `rounded-lg` (8px)
- Padding: `p-4 md:p-6`
- Shadow: **none** (flat design — borders, not shadows)
- Hover: border darkens to `slate-300`, no transform

### Clause Cards (special)
- Same as card, plus: `border-l-4` with risk color
- Left border: `border-l-red-600` / `border-l-amber-600` / `border-l-green-600`
- Entrance animation: `opacity-0 → 1`, `translateY(8px) → 0`, 200ms ease-out, 30ms stagger

### Buttons
- Primary: `bg-amber-500 text-slate-900` (dark text on gold)
- Primary hover: `bg-amber-600`
- Secondary: `border border-slate-300 bg-white text-slate-700`
- Secondary hover: `bg-slate-50`
- Padding: `px-6 py-3` (generous touch targets)
- Radius: `rounded-lg`
- Font: `text-sm font-semibold`
- Transitions: `150ms ease`

### Risk Badges
- Flat pill shape: `rounded-full px-3 py-1`
- Icon (Lucide) + label text
- Red: `bg-red-50 text-red-700 border border-red-200`
- Yellow: `bg-amber-50 text-amber-700 border border-amber-200`
- Green: `bg-green-50 text-green-700 border border-green-200`
- Font: `text-xs font-semibold`

### Upload Zone
- Dashed border: `border-2 border-dashed border-slate-300`
- Background: `bg-slate-50`
- Drag active: `border-amber-500 bg-amber-50/50`
- Radius: `rounded-xl`
- Padding: `p-8 md:p-12`
- Center-aligned icon + text
- No `react-dropzone` — native HTML5

---

## Animation Rules

Restrained. Animations serve function, not decoration.

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Clause card entrance | fade-in + slide-up (8px) | 200ms | ease-out |
| Clause card stagger | 30ms delay per card | — | — |
| Risk score gauge | Count-up from 0 | 800ms | ease-out |
| Status message | Fade transition | 150ms | ease |
| Upload drag state | Border/bg color change | 150ms | ease |
| Button hover | Background color shift | 150ms | ease |
| Skeleton pulse | `animate-pulse` | standard | — |
| BackgroundPaths (hero) | Continuous SVG path flow | 20-30s loop | linear |
| TextShimmer (status bar) | Gradient sweep across text | 3s loop | linear |
| ProcessingLoader (upload) | Bouncing dots | CSS keyframes | ease |

**Rules:**
- No spring physics or bouncing on content elements — too playful for legal tech
- No `scale` transforms on hover — causes layout perception shift
- Respect `prefers-reduced-motion` — disable BackgroundPaths animation, TextShimmer, card stagger. Show static alternatives.
- Max animation duration: 800ms (score gauge). Everything else ≤ 200ms. Exception: BackgroundPaths runs on infinite loop but is purely decorative background.
- `motion` library used ONLY on landing page (BackgroundPaths, TextShimmer). Analysis page is CSS-only.

---

## Layout Principles

- **Max content width:** `max-w-3xl` (768px) — optimized for reading legal text
- **Mobile-first:** Design at 375px, scale up
- **Breakpoints:** 375px (base), 768px (md), 1024px (lg)
- **No sidebar** — vertical card stack, single-column
- **Nav bar:** Dark (`slate-900`), full-width, logo left, minimal right-aligned items
- **Footer:** Light, minimal — legal disclaimer + link only

---

## Icon System

- **Library:** Lucide React (already in shadcn/ui)
- **Stroke width:** 2 (default)
- **Sizes:** 16px (inline), 20px (buttons), 24px (feature icons), 48px (empty states)
- **Never use emojis as icons**

---

## Anti-Patterns (NEVER)

- No gradients (except subtle bg on hero if needed)
- No glassmorphism / blur effects
- No neon colors
- No purple/pink AI gradients
- No shadows heavier than `shadow-sm` (and prefer borders over shadows)
- No `scale` hover transforms
- No rounded-full on cards (only on badges)
- No dark mode for MVP (adds complexity, zero value for portfolio demo)

---

## Pre-Delivery Checklist

- [ ] No emojis used as icons (Lucide SVG only)
- [ ] All icons from Lucide, consistent stroke width
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with transitions (150ms)
- [ ] Text contrast ≥ 4.5:1 on all backgrounds
- [ ] Focus rings visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Tested at: 375px, 768px, 1024px
- [ ] No horizontal scroll on mobile
- [ ] No content hidden behind fixed nav
- [ ] Legal disclaimer visible on both pages
