"use client";

import { motion, useReducedMotion } from "motion/react";

function FloatingPaths({ position }: { position: number }) {
  const shouldReduceMotion = useReducedMotion();

  // Risk-colored paths: red, amber, green at low opacity
  const riskColors = [
    "rgba(239,68,68,0.12)", // red-500
    "rgba(245,158,11,0.12)", // amber-500
    "rgba(34,197,94,0.12)", // green-500
  ];

  const paths = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 8 * position} -${189 + i * 10}C-${
      380 - i * 8 * position
    } -${189 + i * 10} -${312 - i * 8 * position} ${216 - i * 10} ${
      152 - i * 8 * position
    } ${343 - i * 10}C${616 - i * 8 * position} ${470 - i * 10} ${
      684 - i * 8 * position
    } ${875 - i * 10} ${684 - i * 8 * position} ${875 - i * 10}`,
    color: riskColors[i % riskColors.length],
    width: 2 + (i % 3),
  }));

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="size-full" viewBox="0 0 696 316" fill="none" aria-hidden="true">
        <title>Background Paths</title>
        {paths.map((path) =>
          shouldReduceMotion ? (
            <path
              key={path.id}
              d={path.d}
              stroke={path.color}
              strokeWidth={path.width}
              fill="none"
            />
          ) : (
            <motion.path
              key={path.id}
              d={path.d}
              stroke={path.color}
              strokeWidth={path.width}
              fill="none"
              initial={{ pathLength: 0.3, opacity: 0.6 }}
              animate={{
                pathLength: 1,
                opacity: [0.3, 0.6, 0.3],
                pathOffset: [0, 1, 0],
              }}
              transition={{
                duration: 20 + Math.random() * 10,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          ),
        )}
      </svg>
    </div>
  );
}

export function BackgroundPaths() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
