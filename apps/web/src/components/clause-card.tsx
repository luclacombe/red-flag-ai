"use client";

import type { ClauseAnalysis, RiskLevel } from "@redflag/shared";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RiskBadge } from "./risk-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const RISK_HEX: Record<RiskLevel, string> = {
  red: "#DC2626",
  yellow: "#E17100",
  green: "#00A73D",
};

interface ClauseCardProps {
  clause: ClauseAnalysis;
  animate?: boolean;
  animationDelay?: number;
  /** When true, show only category + badge + brief explanation (no clause text) */
  compact?: boolean;
  className?: string;
  /** Combined box-shadow string (left edge + optional glow) */
  boxShadow?: string;
}

export function ClauseCard({
  clause,
  animate = false,
  animationDelay = 0,
  compact = false,
  className,
  boxShadow,
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

  const hasSaferAlt = !!clause.saferAlternative && clause.riskLevel !== "green";

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm transition-all duration-200",
        compact ? "pl-4 pr-3 py-3" : "pl-5 pr-4 py-4 md:pl-6 md:pr-5 md:py-5",
        animate && "animate-[fade-slide-in_200ms_ease-out_both]",
        className,
      )}
      style={{
        boxShadow: boxShadow ?? `inset 4px 0 0 0 ${RISK_HEX[clause.riskLevel]}`,
        ...(animate ? { animationDelay: `${animationDelay}ms` } : {}),
      }}
    >
      {/* Category + Badge row */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {clause.category.replace(/_/g, " ")}
        </span>
        <RiskBadge level={clause.riskLevel} />
      </div>

      {/* Clause text — hidden in compact mode (shown in document panel instead) */}
      {!compact && (
        <>
          <pre
            ref={textRef}
            className={cn(
              "mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-300",
              !textExpanded && isLongText && "line-clamp-3",
            )}
          >
            {clause.clauseText}
          </pre>
          {isLongText && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setTextExpanded(!textExpanded);
              }}
              className="mt-1 cursor-pointer rounded text-xs font-medium text-blue-400 transition-colors duration-150 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-[#0B1120]"
              aria-expanded={textExpanded}
            >
              {textExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}

      {/* Explanation */}
      <p className={cn("text-sm text-slate-300", !compact && "mt-3")}>{clause.explanation}</p>

      {/* Safer alternative — only for red/yellow clauses */}
      {hasSaferAlt && (
        <Collapsible open={altExpanded} onOpenChange={setAltExpanded}>
          {/* stopPropagation prevents click from toggling the pin state on the parent wrapper */}
          <CollapsibleTrigger
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="mt-3 flex cursor-pointer items-center gap-1.5 rounded text-sm font-medium text-green-400 transition-colors duration-150 hover:text-green-300 focus:outline-none"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-150",
                altExpanded && "rotate-180",
              )}
            />
            Safer alternative
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
              <p className="text-sm text-green-300">{clause.saferAlternative}</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
