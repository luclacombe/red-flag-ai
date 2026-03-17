"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type RiskColor = "green" | "amber" | "red";

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
    label: "Auto-Renewal Trap",
    risk: "red",
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
    label: "Unusual Penalty",
    risk: "amber",
    width: 200,
    height: 52,
    rotate: -8,
    delay: 0.3,
    className: "right-[12%] top-[2%] md:right-[12%] md:top-[2%]",
    hideOnMobile: true,
  },
];

const AUTH_PILLS: PillConfig[] = [
  {
    label: "",
    risk: "green",
    width: 260,
    height: 68,
    rotate: 12,
    delay: 0.1,
    className: "left-[-15%] top-[20%]",
  },
  {
    label: "",
    risk: "red",
    width: 230,
    height: 60,
    rotate: -15,
    delay: 0.2,
    className: "right-[-10%] top-[70%]",
  },
  {
    label: "",
    risk: "amber",
    width: 190,
    height: 50,
    rotate: -8,
    delay: 0.3,
    className: "left-[10%] bottom-[10%]",
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

const AUTH_GRADIENT_MAP: Record<RiskColor, { gradient: string; border: string }> = {
  green: {
    gradient: "from-green-500/[0.12]",
    border: "border-green-400/[0.12]",
  },
  amber: {
    gradient: "from-amber-500/[0.12]",
    border: "border-amber-400/[0.12]",
  },
  red: {
    gradient: "from-red-500/[0.12]",
    border: "border-red-400/[0.12]",
  },
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
}: PillConfig & { isAuth?: boolean; isStatic?: boolean }) {
  const textColor = isAuth ? "" : GRADIENT_MAP[risk].text;
  const colors = isAuth ? AUTH_GRADIENT_MAP[risk] : GRADIENT_MAP[risk];

  const pillContent = (
    <div
      className={cn(
        "absolute inset-0 rounded-full",
        "bg-gradient-to-r to-transparent",
        colors.gradient,
        "backdrop-blur-[2px] border-2",
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

  if (isStatic) {
    return (
      <div className={cn("absolute", hideOnMobile && "hidden md:block", className)}>
        <div style={{ width, height }} className="relative">
          {pillContent}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -150, rotate: rotate - 15 }}
      animate={{ opacity: 1, y: 0, rotate }}
      transition={{
        duration: 1.8,
        delay,
        ease: [0.23, 0.86, 0.39, 0.96],
        opacity: { duration: 1 },
      }}
      className={cn("absolute", hideOnMobile && "hidden md:block", className)}
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

export function BackgroundPaths({ variant = "hero" }: BackgroundPathsProps) {
  const shouldReduceMotion = useReducedMotion();
  const pills = variant === "hero" ? HERO_PILLS : AUTH_PILLS;
  const isAuth = variant === "auth";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-br from-green-500/[0.03] via-transparent to-red-500/[0.03] blur-3xl" />

      {pills.map((pill) => (
        <ElegantPill
          key={pill.label || `${pill.risk}-${pill.rotate}`}
          {...pill}
          isAuth={isAuth}
          isStatic={shouldReduceMotion ?? false}
        />
      ))}
    </div>
  );
}
