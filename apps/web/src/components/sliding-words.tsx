"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SlidingWordsProps {
  words: string[];
  interval?: number;
  className?: string;
}

export function SlidingWords({ words, interval = 2500, className }: SlidingWordsProps) {
  const [index, setIndex] = useState(0);
  const shouldReduceMotion = useReducedMotion();
  const wordsLength = words.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % wordsLength);
    }, interval);
    return () => clearInterval(timer);
  }, [wordsLength, interval]);

  if (shouldReduceMotion) {
    return <span className={className}>{words[index] ?? words[0]}</span>;
  }

  return (
    <span className="relative flex w-full items-center justify-center overflow-hidden text-center min-h-[2.2em] md:min-h-[1.3em] my-1">
      {/* Invisible spacer for width — keeps container from collapsing */}
      &nbsp;
      {words.map((word, i) => (
        <motion.span
          key={word}
          className={cn(
            "absolute inset-0 flex items-center justify-center font-semibold",
            className,
          )}
          initial={{ opacity: 0, y: 150 }}
          animate={index === i ? { y: 0, opacity: 1 } : { y: index > i ? -150 : 150, opacity: 0 }}
          transition={{
            type: "spring",
            stiffness: 80,
            damping: 25,
          }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}
