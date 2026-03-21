"use client";

import type { RiskLevel } from "@redflag/shared";
import type { ReactNode } from "react";
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
  hoveredClause: number | null;
  pinnedClause: number | null;
  onClauseHover: (position: number | null) => void;
  onClauseClick: (position: number) => void;
  /** Callback ref to expose the inner scrollable container */
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
  /** Optional render callback: called inside each clause highlight block.
   *  Returns a ReactNode to render as the last child of the clause div (mobile layout). */
  renderClauseSlot?: (position: number) => ReactNode;
  /** Dark theme variant for mobile inline layout */
  dark?: boolean;
}

const RISK_HEX: Record<string, string> = {
  red: "#DC2626",
  yellow: "#E17100",
  green: "#00A73D",
};

const riskBgLight: Record<string, string> = {
  red: "bg-red-50",
  yellow: "bg-amber-50",
  green: "bg-green-50/60",
  analyzing: "clause-analyzing",
  pending: "bg-slate-50/40",
  flashing: "bg-white",
};

const riskBgDark: Record<string, string> = {
  red: "bg-red-500/10",
  yellow: "bg-amber-500/10",
  green: "bg-green-500/10",
  analyzing: "clause-analyzing",
  pending: "bg-slate-500/10",
  flashing: "bg-white/20",
};

const fallbackBorderColors: Record<string, string> = {
  analyzing: "#94a3b8",
  pending: "#cbd5e1",
  flashing: "#60a5fa",
};

const RISK_RGBA: Record<string, string> = {
  red: "220, 38, 38",
  yellow: "225, 113, 0",
  green: "0, 167, 61",
};

function getDocClauseShadow(riskLevel: string, isPinned: boolean, isHovered: boolean): string {
  const hex = RISK_HEX[riskLevel] ?? fallbackBorderColors[riskLevel] ?? "#cbd5e1";
  const base = `inset 4px 0 0 0 ${hex}`;
  const rgba = RISK_RGBA[riskLevel];
  if (isPinned && rgba) return `${base}, inset 0 0 0 2px ${hex}, 0 0 12px 2px rgba(${rgba}, 0.35)`;
  if (isHovered && rgba) return `${base}, 0 0 8px 1px rgba(${rgba}, 0.2)`;
  return base;
}

/**
 * Enhanced plain text document viewer with block-level clause highlighting.
 * Each clause is rendered as a full-width <div> block (not inline <span>)
 * to fix hover/selection issues. Paragraphs preserved within segments.
 *
 * `dark` variant uses dark background + light text for mobile inline layout.
 */
export function TextDocumentPanel({
  text,
  clauses,
  hoveredClause,
  pinnedClause,
  onClauseHover,
  onClauseClick,
  onScrollContainerRef,
  renderClauseSlot,
  dark = false,
}: TextDocumentPanelProps) {
  const clauseRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const riskBgClasses = dark ? riskBgDark : riskBgLight;

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
      className={cn(
        "scrollbar-hidden h-full overflow-y-auto rounded-xl",
        dark ? "border border-white/10 bg-[#0F1629]" : "border border-slate-200 bg-white shadow-sm",
      )}
    >
      <div className={cn("p-5", !dark && "md:p-8")}>
        {segments.map((segment) => {
          if (segment.type === "text") {
            return (
              <TextBlock
                key={segment.key}
                content={segment.content}
                className={dark ? "text-slate-400" : undefined}
              />
            );
          }

          const { highlight } = segment;
          const isPinned = pinnedClause === highlight.position;
          const isHovered = hoveredClause === highlight.position && !isPinned;
          const isLit = isPinned || isHovered;
          const bgClass = riskBgClasses[highlight.riskLevel] ?? riskBgClasses.pending;
          const isEvenPos = highlight.position % 2 === 0;

          const slotContent = renderClauseSlot?.(highlight.position);

          return (
            // biome-ignore lint/a11y/useSemanticElements: div needed for block-level highlighting
            <div
              key={segment.key}
              ref={setClauseRef(highlight.position)}
              role="button"
              tabIndex={0}
              data-clause-position={highlight.position}
              className={cn(
                "relative -mx-3 cursor-pointer rounded-lg pl-4 pr-3 py-2 transition-all duration-300",
                bgClass,
                isLit && "z-10",
                isEvenPos && !slotContent && "opacity-95",
                slotContent && "pb-3",
              )}
              style={{
                boxShadow: getDocClauseShadow(highlight.riskLevel, isPinned, isHovered),
              }}
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
              <TextBlock
                content={segment.content}
                className={dark ? "text-slate-200" : "text-slate-700"}
              />
              {slotContent}
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
