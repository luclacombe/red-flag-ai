"use client";

import type { ClauseAnalysis, RiskLevel } from "@redflag/shared";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RiskBadge } from "./risk-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const borderColors: Record<RiskLevel, string> = {
  red: "border-l-red-600",
  yellow: "border-l-amber-600",
  green: "border-l-green-600",
};

interface ClauseCardProps {
  clause: ClauseAnalysis;
  animate?: boolean;
  animationDelay?: number;
  className?: string;
}

export function ClauseCard({
  clause,
  animate = false,
  animationDelay = 0,
  className,
}: ClauseCardProps) {
  const [textExpanded, setTextExpanded] = useState(false);
  const [altExpanded, setAltExpanded] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  const [isLongText, setIsLongText] = useState(false);

  useEffect(() => {
    if (textRef.current) {
      const lineHeight = Number.parseFloat(getComputedStyle(textRef.current).lineHeight);
      setIsLongText(textRef.current.scrollHeight > lineHeight * 3.5);
    }
  }, []);

  const hasSaferAlt = clause.saferAlternative != null && clause.riskLevel !== "green";

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 border-l-4 bg-white p-4 md:p-6",
        borderColors[clause.riskLevel],
        animate && "animate-[fade-slide-in_200ms_ease-out_both]",
        className,
      )}
      style={animate ? { animationDelay: `${animationDelay}ms` } : undefined}
    >
      {/* Category + Badge row */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {clause.category}
        </span>
        <RiskBadge level={clause.riskLevel} />
      </div>

      {/* Clause text */}
      <pre
        ref={textRef}
        className={cn(
          "mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-700",
          !textExpanded && isLongText && "line-clamp-3",
        )}
      >
        {clause.clauseText}
      </pre>
      {isLongText && (
        <button
          type="button"
          onClick={() => setTextExpanded(!textExpanded)}
          className="mt-1 cursor-pointer rounded text-xs font-medium text-blue-600 transition-colors duration-150 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1"
          aria-expanded={textExpanded}
        >
          {textExpanded ? "Show less" : "Show more"}
        </button>
      )}

      {/* Explanation */}
      <p className="mt-3 text-sm text-slate-600">{clause.explanation}</p>

      {/* Safer alternative — only for red/yellow clauses */}
      {hasSaferAlt && (
        <Collapsible open={altExpanded} onOpenChange={setAltExpanded}>
          <CollapsibleTrigger className="mt-3 flex cursor-pointer items-center gap-1.5 rounded text-sm font-medium text-green-700 transition-colors duration-150 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1">
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-150",
                altExpanded && "rotate-180",
              )}
            />
            Safer alternative
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md bg-green-50 p-3">
              <p className="text-sm text-green-800">{clause.saferAlternative}</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
