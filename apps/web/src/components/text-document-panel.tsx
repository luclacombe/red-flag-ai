"use client";

import type { RiskLevel } from "@redflag/shared";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface ClauseHighlight {
  startIndex: number;
  endIndex: number;
  position: number;
  riskLevel: RiskLevel | "analyzing" | "pending" | "flashing";
}

interface TextDocumentPanelProps {
  text: string;
  clauses: ClauseHighlight[];
  activeClause: number | null;
  onClauseHover: (position: number | null) => void;
  onClauseClick: (position: number) => void;
  /** Callback ref to expose the inner scrollable container */
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
}

const riskBgColors: Record<string, string> = {
  red: "bg-red-50 border-l-red-500",
  yellow: "bg-amber-50 border-l-amber-500",
  green: "bg-green-50/60 border-l-green-400",
  analyzing: "clause-analyzing border-l-slate-400",
  pending: "bg-slate-50/40 border-l-slate-300",
  flashing: "bg-white border-l-blue-400",
};

/**
 * Enhanced plain text document viewer with block-level clause highlighting.
 * Each clause is rendered as a full-width <div> block (not inline <span>)
 * to fix hover/selection issues. Paragraphs preserved within segments.
 */
export function TextDocumentPanel({
  text,
  clauses,
  activeClause,
  onClauseHover,
  onClauseClick,
  onScrollContainerRef,
}: TextDocumentPanelProps) {
  const clauseRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const setClauseRef = useCallback(
    (position: number) => (el: HTMLDivElement | null) => {
      if (el) clauseRefs.current.set(position, el);
      else clauseRefs.current.delete(position);
    },
    [],
  );

  const scrollContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      onScrollContainerRef?.(el);
    },
    [onScrollContainerRef],
  );

  // Sort clauses by startIndex for rendering order
  const sortedClauses = [...clauses]
    .filter((c) => c.startIndex >= 0)
    .sort((a, b) => a.startIndex - b.startIndex);

  // Build segments: interleave plain text blocks + clause blocks
  const segments: Array<
    | { type: "text"; content: string; key: string }
    | { type: "clause"; content: string; highlight: ClauseHighlight; key: string }
  > = [];

  let cursor = 0;
  for (let i = 0; i < sortedClauses.length; i++) {
    const clause = sortedClauses[i];
    if (!clause) continue;
    if (clause.startIndex > cursor) {
      segments.push({
        type: "text",
        content: text.slice(cursor, clause.startIndex),
        key: `text-${i}`,
      });
    }
    segments.push({
      type: "clause",
      content: text.slice(clause.startIndex, clause.endIndex),
      highlight: clause,
      key: `clause-${clause.position}`,
    });
    cursor = clause.endIndex;
  }
  if (cursor < text.length) {
    segments.push({
      type: "text",
      content: text.slice(cursor),
      key: "text-tail",
    });
  }

  return (
    <div
      ref={scrollContainerRef}
      className="h-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="p-6 md:p-8">
        {segments.map((segment) => {
          if (segment.type === "text") {
            return <TextBlock key={segment.key} content={segment.content} />;
          }

          const { highlight } = segment;
          const isActive = activeClause === highlight.position;
          const bgClass = riskBgColors[highlight.riskLevel] ?? riskBgColors.pending;
          // Alternate shade for adjacent same-risk clauses
          const isEvenPos = highlight.position % 2 === 0;

          return (
            // biome-ignore lint/a11y/useSemanticElements: div needed for block-level highlighting
            <div
              key={segment.key}
              ref={setClauseRef(highlight.position)}
              role="button"
              tabIndex={0}
              data-clause-position={highlight.position}
              className={cn(
                "relative -mx-3 cursor-pointer rounded-lg border-l-4 px-3 py-2 transition-all duration-300",
                bgClass,
                isActive && "ring-2 ring-blue-400/50 brightness-95",
                isEvenPos && "opacity-95",
              )}
              onMouseEnter={() => onClauseHover(highlight.position)}
              onMouseLeave={() => onClauseHover(null)}
              onClick={() => onClauseClick(highlight.position)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClauseClick(highlight.position);
                }
              }}
            >
              <TextBlock content={segment.content} className="text-slate-700" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Renders text content preserving paragraph breaks */
function TextBlock({ content, className }: { content: string; className?: string }) {
  // Split on double newlines for paragraphs
  const paragraphs = content.split(/\n{2,}/);

  return (
    <div className={cn("font-body text-sm leading-relaxed text-slate-500", className)}>
      {paragraphs.map((para, idx) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraph index within text segment is stable
          key={idx}
          className={cn(idx > 0 && "mt-3", "whitespace-pre-wrap")}
        >
          {para}
        </p>
      ))}
    </div>
  );
}
