"use client";

import { motion, useReducedMotion } from "motion/react";
import { memo } from "react";
import { cn } from "@/lib/utils";

type RiskColor = "green" | "amber" | "red";
type DepthLayer = "foreground" | "midground" | "background";

interface PillConfig {
  label: string;
  risk: RiskColor;
  width: number;
  height: number;
  rotate: number;
  delay: number;
  className: string;
  /** Hide on mobile */
  hideOnMobile?: boolean;
  /** Depth layer — controls blur, opacity, and animation strategy */
  layer?: DepthLayer;
}

// Composition: 5 pills framing the hero content. Clear center zone —
// no pill should overlap with the heading, subtitle, or CTA button.
// Mobile: pills pushed much further to edges with shallower angles.
// Desktop: pills in periphery, partially clipped.
const HERO_PILLS: PillConfig[] = [
  // Upper-left — green, mostly off-screen on mobile
  {
    label: "Standard Clause",
    risk: "green",
    width: 280,
    height: 72,
    rotate: 12,
    delay: 0.1,
    className: "left-[-22%] top-[4%] md:left-[-4%] md:top-[10%]",
  },
  // Upper-right — amber, clipped by right edge
  {
    label: "Hidden Fee Detected",
    risk: "amber",
    width: 260,
    height: 66,
    rotate: -10,
    delay: 0.2,
    className: "right-[-20%] top-[6%] md:right-[-2%] md:top-[16%]",
  },
  // Lower-left — red, pushed to bottom-left corner
  {
    label: "Unusual Penalty",
    risk: "amber",
    width: 250,
    height: 64,
    rotate: -12,
    delay: 0.25,
    className: "left-[-18%] bottom-[6%] md:left-[0%] md:bottom-[10%]",
  },
  // Lower-right — green, desktop only
  {
    label: "Fair Terms",
    risk: "green",
    width: 230,
    height: 60,
    rotate: 15,
    delay: 0.35,
    className: "right-[0%] bottom-[14%] md:right-[0%] md:bottom-[14%]",
    hideOnMobile: true,
  },
  // Small accent upper-right, desktop only
  {
    label: "Auto-Renewal Trap",
    risk: "red",
    width: 200,
    height: 52,
    rotate: -8,
    delay: 0.3,
    className: "right-[12%] top-[2%] md:right-[12%] md:top-[2%]",
    hideOnMobile: true,
  },
  // ── Background: desktop only — subtle atmospheric depth, no labels ──
  // Upper-center gap between Standard Clause and Auto-Renewal Trap
  {
    label: "",
    risk: "green",
    width: 140,
    height: 36,
    rotate: -14,
    delay: 0.45,
    className: "left-[22%] top-[3%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Right mid — between Hidden Fee and Fair Terms
  {
    label: "",
    risk: "red",
    width: 130,
    height: 34,
    rotate: 18,
    delay: 0.5,
    className: "right-[8%] top-[44%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Left mid — between Standard Clause and Unusual Penalty
  {
    label: "",
    risk: "amber",
    width: 120,
    height: 32,
    rotate: -10,
    delay: 0.55,
    className: "left-[6%] top-[48%]",
    layer: "background",
    hideOnMobile: true,
  },
];

// ─── Auth pills: 3-layer depth composition ───
// Foreground: large, crisp, full animation — visual anchors at edges
// Midground: medium, slight blur, slower idle — fills gaps
// Background: blurred, dark, CSS-only — atmospheric depth
//
// Mobile strategy: pills use scale-[0.7]/scale-[0.55] + mild negative-% positions.
// Positioned to frame the card on all sides (corners + edges), not just top.
// 7 pills on mobile (4 fg + 3 mid) vs 16 on desktop.
// Tailwind v4 `scale` is a separate CSS property, composes with motion's `transform`.
const AUTH_PILLS: PillConfig[] = [
  // ── Foreground: mobile + desktop — main visual anchors ──
  // Top-left — green. Mobile: partially clipped, visible beside logo
  {
    label: "",
    risk: "green",
    width: 270,
    height: 68,
    rotate: 10,
    delay: 0.1,
    className: "left-[-10%] top-[4%] scale-[0.7] md:left-[-8%] md:top-[18%] md:scale-100",
    layer: "foreground",
  },
  // Bottom-left — amber. Mobile: visible below card
  {
    label: "",
    risk: "amber",
    width: 230,
    height: 58,
    rotate: -8,
    delay: 0.3,
    className: "left-[-6%] bottom-[6%] scale-[0.7] md:left-[0%] md:bottom-[8%] md:scale-100",
    layer: "foreground",
  },
  // Right mid — red. Mobile: peeking from right edge beside card
  {
    label: "",
    risk: "red",
    width: 260,
    height: 66,
    rotate: -12,
    delay: 0.2,
    className: "right-[-12%] top-[55%] scale-[0.7] md:right-[-6%] md:top-[52%] md:scale-100",
    layer: "foreground",
  },
  // Top-right — red. Mobile: partially visible in top-right corner
  {
    label: "",
    risk: "red",
    width: 240,
    height: 60,
    rotate: -20,
    delay: 0.15,
    className: "right-[-8%] top-[1%] scale-[0.6] md:right-[16%] md:top-[16%] md:scale-100",
    layer: "foreground",
  },
  // ── Midground: mobile + desktop — fills gaps ──
  // Left edge mid — beside card on mobile, fills left side gap
  {
    label: "",
    risk: "red",
    width: 165,
    height: 44,
    rotate: -14,
    delay: 0.3,
    className: "left-[-8%] top-[48%] scale-[0.55] md:left-[10%] md:top-[55%] md:scale-100",
    layer: "midground",
  },
  // Right upper — green. Mobile: right edge above card mid
  {
    label: "",
    risk: "green",
    width: 180,
    height: 46,
    rotate: 12,
    delay: 0.25,
    className: "right-[-10%] top-[16%] scale-[0.55] md:right-[2%] md:top-[14%] md:scale-100",
    layer: "midground",
  },
  // Bottom-right — amber. Mobile: visible in bottom-right
  {
    label: "",
    risk: "amber",
    width: 175,
    height: 46,
    rotate: 8,
    delay: 0.35,
    className: "right-[-6%] bottom-[8%] scale-[0.55] md:right-[4%] md:bottom-[10%] md:scale-100",
    layer: "midground",
  },
  // ── Midground: desktop only ──
  // Upper-left accent
  {
    label: "",
    risk: "amber",
    width: 190,
    height: 50,
    rotate: -6,
    delay: 0.15,
    className: "left-[6%] top-[4%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Left mid — between top-left fg and bottom-left fg
  {
    label: "",
    risk: "red",
    width: 165,
    height: 44,
    rotate: -14,
    delay: 0.3,
    className: "left-[10%] top-[55%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Left lower
  {
    label: "",
    risk: "green",
    width: 155,
    height: 42,
    rotate: 10,
    delay: 0.4,
    className: "left-[16%] bottom-[20%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // ── Midground: desktop only — behind/overlapping card edges ──
  // Card is max-w-sm (384px) centered ≈ 37%-63% horizontal, 22%-75% vertical.
  // These pills straddle the card edge: sharp outside, soft behind the glass.
  // Upper-right card overlap — green (complements the red fg pill nearby)
  {
    label: "",
    risk: "green",
    width: 170,
    height: 44,
    rotate: 10,
    delay: 0.5,
    className: "right-[28%] top-[22%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Upper-left card overlap — red accent, fills gap left of card top
  {
    label: "",
    risk: "red",
    width: 160,
    height: 42,
    rotate: -10,
    delay: 0.48,
    className: "left-[26%] top-[24%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Below card center — amber, fills the empty zone under the card
  {
    label: "",
    risk: "amber",
    width: 165,
    height: 44,
    rotate: 8,
    delay: 0.52,
    className: "left-[42%] bottom-[14%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Lower-left card overlap — amber warmth near card base
  {
    label: "",
    risk: "amber",
    width: 155,
    height: 40,
    rotate: -12,
    delay: 0.55,
    className: "left-[30%] bottom-[20%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Lower-right card edge — subtle green, mostly behind card
  {
    label: "",
    risk: "green",
    width: 140,
    height: 38,
    rotate: -6,
    delay: 0.6,
    className: "right-[32%] bottom-[26%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // ── Midground: desktop only — fully behind card (visible through glass) ──
  // Card zone ≈ left 37%-63%, top 22%-75%. Pills here are softened by backdrop-blur-xl.
  // Behind heading area — green, upper-left of card interior
  {
    label: "",
    risk: "green",
    width: 150,
    height: 40,
    rotate: 14,
    delay: 0.46,
    className: "left-[36%] top-[26%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Behind email field — red, right side of card interior
  {
    label: "",
    risk: "red",
    width: 160,
    height: 42,
    rotate: -8,
    delay: 0.52,
    className: "right-[34%] top-[36%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Behind password/button area — amber, center-left
  {
    label: "",
    risk: "amber",
    width: 145,
    height: 38,
    rotate: 12,
    delay: 0.58,
    className: "left-[40%] top-[48%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // Behind magic link area — green, center-right
  {
    label: "",
    risk: "green",
    width: 155,
    height: 40,
    rotate: -16,
    delay: 0.62,
    className: "right-[36%] top-[60%]",
    layer: "midground",
    hideOnMobile: true,
  },
  // ── Background: desktop only — atmospheric depth ──
  // Upper center-left
  {
    label: "",
    risk: "green",
    width: 155,
    height: 42,
    rotate: 18,
    delay: 0.4,
    className: "left-[20%] top-[8%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Right mid — fills center-right gap
  {
    label: "",
    risk: "red",
    width: 150,
    height: 40,
    rotate: -16,
    delay: 0.5,
    className: "right-[18%] top-[38%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Lower center-right
  {
    label: "",
    risk: "amber",
    width: 140,
    height: 38,
    rotate: 14,
    delay: 0.55,
    className: "right-[22%] bottom-[6%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Upper center-right
  {
    label: "",
    risk: "amber",
    width: 135,
    height: 36,
    rotate: -10,
    delay: 0.45,
    className: "right-[26%] top-[5%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Center-left lower
  {
    label: "",
    risk: "red",
    width: 130,
    height: 36,
    rotate: 16,
    delay: 0.6,
    className: "left-[26%] bottom-[14%]",
    layer: "background",
    hideOnMobile: true,
  },
  // Center-right mid
  {
    label: "",
    risk: "green",
    width: 125,
    height: 34,
    rotate: -12,
    delay: 0.65,
    className: "right-[30%] top-[60%]",
    layer: "background",
    hideOnMobile: true,
  },
];

const GRADIENT_MAP: Record<RiskColor, { gradient: string; border: string; text: string }> = {
  green: {
    gradient: "from-green-500/[0.20]",
    border: "border-green-400/[0.20]",
    text: "text-green-400/50",
  },
  amber: {
    gradient: "from-amber-500/[0.22]",
    border: "border-amber-400/[0.22]",
    text: "text-amber-400/50",
  },
  red: {
    gradient: "from-red-500/[0.22]",
    border: "border-red-400/[0.22]",
    text: "text-red-400/50",
  },
};

// Auth foreground: slightly more opaque fill to compensate for removed backdrop-blur
const AUTH_FG_GRADIENT_MAP: Record<RiskColor, { gradient: string; border: string }> = {
  green: {
    gradient: "from-green-500/[0.15]",
    border: "border-green-400/[0.15]",
  },
  amber: {
    gradient: "from-amber-500/[0.16]",
    border: "border-amber-400/[0.16]",
  },
  red: {
    gradient: "from-red-500/[0.16]",
    border: "border-red-400/[0.16]",
  },
};

// Auth midground: reduced presence
const AUTH_MID_GRADIENT_MAP: Record<RiskColor, { gradient: string; border: string }> = {
  green: {
    gradient: "from-green-500/[0.10]",
    border: "border-green-400/[0.08]",
  },
  amber: {
    gradient: "from-amber-500/[0.11]",
    border: "border-amber-400/[0.09]",
  },
  red: {
    gradient: "from-red-500/[0.11]",
    border: "border-red-400/[0.09]",
  },
};

// Auth background: faint, atmospheric
const AUTH_BG_GRADIENT_MAP: Record<RiskColor, { gradient: string; border: string }> = {
  green: {
    gradient: "from-green-500/[0.06]",
    border: "border-green-400/[0.04]",
  },
  amber: {
    gradient: "from-amber-500/[0.07]",
    border: "border-amber-400/[0.05]",
  },
  red: {
    gradient: "from-red-500/[0.07]",
    border: "border-red-400/[0.05]",
  },
};

function getAuthColors(risk: RiskColor, layer: DepthLayer) {
  switch (layer) {
    case "foreground":
      return AUTH_FG_GRADIENT_MAP[risk];
    case "midground":
      return AUTH_MID_GRADIENT_MAP[risk];
    case "background":
      return AUTH_BG_GRADIENT_MAP[risk];
  }
}

// Layer-specific blur and opacity (applied via inline style for auth pills)
const LAYER_STYLES: Record<DepthLayer, { filter: string; opacity: number }> = {
  foreground: { filter: "none", opacity: 1 },
  midground: { filter: "blur(1.5px)", opacity: 0.55 },
  background: { filter: "blur(3px)", opacity: 0.3 },
};

function ElegantPill({
  label,
  risk,
  width,
  height,
  rotate,
  delay,
  className,
  hideOnMobile,
  isAuth,
  isStatic,
  layer = "foreground",
}: PillConfig & { isAuth?: boolean; isStatic?: boolean }) {
  const textColor = isAuth ? "" : GRADIENT_MAP[risk].text;
  const colors = isAuth ? getAuthColors(risk, layer) : GRADIENT_MAP[risk];
  // Depth styles apply to all variants — hero background pills get blur+opacity too
  const layerStyle = LAYER_STYLES[layer];
  // Only hero foreground pills use backdrop-blur (few pills, no re-renders from typing).
  // Auth pills and non-foreground hero pills skip it for performance/clarity.
  const useBackdropBlur = !isAuth && layer === "foreground";

  const pillContent = (
    <div
      className={cn(
        "absolute inset-0 rounded-full",
        "bg-gradient-to-r to-transparent",
        colors.gradient,
        useBackdropBlur && "backdrop-blur-[2px]",
        "border-2",
        colors.border,
        "shadow-[0_8px_32px_0_rgba(255,255,255,0.1)]",
        "after:absolute after:inset-0 after:rounded-full",
        "after:bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.2),transparent_70%)]",
      )}
    >
      {label && (
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "font-heading text-[9px] font-semibold tracking-wider sm:text-[11px]",
            "pointer-events-none select-none",
            textColor,
          )}
        >
          {label}
        </span>
      )}
    </div>
  );

  const needsDepthStyle = layer !== "foreground";

  if (isStatic) {
    return (
      <div
        className={cn("absolute", hideOnMobile && "hidden md:block", className)}
        style={
          needsDepthStyle ? { filter: layerStyle.filter, opacity: layerStyle.opacity } : undefined
        }
      >
        <div style={{ width, height }} className="relative">
          {pillContent}
        </div>
      </div>
    );
  }

  // Background pills: CSS-only fade-in, no idle animation, no motion library
  if (layer === "background") {
    return (
      <div
        className={cn(
          "absolute animate-[pill-fade-in_1.2s_ease-out_both]",
          hideOnMobile && "hidden md:block",
          className,
        )}
        style={{
          animationDelay: `${delay}s`,
          transform: `rotate(${rotate}deg)`,
          filter: layerStyle.filter,
          opacity: 0, // initial — animation sets final opacity
        }}
      >
        <div style={{ width, height }} className="relative">
          {pillContent}
        </div>
      </div>
    );
  }

  // Midground pills: motion entry + slower idle float
  if (layer === "midground") {
    return (
      <motion.div
        initial={{ opacity: 0, y: -80, rotate: rotate - 10 }}
        animate={{ opacity: layerStyle.opacity, y: 0, rotate }}
        transition={{
          duration: 1.4,
          delay,
          ease: [0.23, 0.86, 0.39, 0.96],
          opacity: { duration: 0.8 },
        }}
        className={cn("absolute", hideOnMobile && "hidden md:block", className)}
        style={{ filter: layerStyle.filter }}
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{
            duration: 20,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
          style={{ width, height }}
          className="relative"
        >
          {pillContent}
        </motion.div>
      </motion.div>
    );
  }

  // Foreground pills (and all hero pills): full entry + 12s idle float
  return (
    <motion.div
      initial={{ opacity: 0, y: -150, rotate: rotate - 15 }}
      animate={{ opacity: isAuth ? layerStyle.opacity : 1, y: 0, rotate }}
      transition={{
        duration: 1.8,
        delay,
        ease: [0.23, 0.86, 0.39, 0.96],
        opacity: { duration: 1 },
      }}
      className={cn("absolute", hideOnMobile && "hidden md:block", className)}
      style={isAuth ? { filter: layerStyle.filter } : undefined}
    >
      <motion.div
        animate={{ y: [0, 15, 0] }}
        transition={{
          duration: 12,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
        style={{ width, height }}
        className="relative"
      >
        {pillContent}
      </motion.div>
    </motion.div>
  );
}

interface BackgroundPathsProps {
  variant?: "hero" | "auth";
}

export const BackgroundPaths = memo(function BackgroundPaths({
  variant = "hero",
}: BackgroundPathsProps) {
  const shouldReduceMotion = useReducedMotion();
  const pills = variant === "hero" ? HERO_PILLS : AUTH_PILLS;
  const isAuth = variant === "auth";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-br from-green-500/[0.03] via-transparent to-red-500/[0.03] blur-3xl" />

      {pills.map((pill) => (
        <ElegantPill
          key={`${pill.risk}-${pill.rotate}-${pill.width}-${pill.className}`}
          {...pill}
          isAuth={isAuth}
          isStatic={shouldReduceMotion ?? false}
        />
      ))}
    </div>
  );
});
