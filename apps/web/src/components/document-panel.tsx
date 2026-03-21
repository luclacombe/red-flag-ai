"use client";

import type { RiskLevel } from "@redflag/shared";
import type { ReactNode } from "react";
import { TextDocumentPanel } from "./text-document-panel";

export interface ClauseHighlight {
  startIndex: number;
  endIndex: number;
  position: number;
  riskLevel: RiskLevel | "analyzing" | "pending" | "flashing";
}

interface DocumentPanelProps {
  /** Full extracted document text */
  text: string;
  /** Clause highlights to render */
  clauses: ClauseHighlight[];
  /** Currently hovered clause position */
  hoveredClause: number | null;
  /** Currently pinned (clicked) clause position */
  pinnedClause: number | null;
  /** Callback when user interacts with a clause */
  onClauseHover: (position: number | null) => void;
  onClauseClick: (position: number) => void;
  /** Callback ref to expose the inner scrollable container */
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
  /** Optional render callback for inline clause cards (mobile layout) */
  renderClauseSlot?: (position: number) => ReactNode;
  /** Dark theme variant for mobile inline layout */
  dark?: boolean;
}

/**
 * Document panel dispatcher.
 * Currently renders TextDocumentPanel for all file types.
 * Future: PdfViewer for PDFs when react-pdf is integrated.
 */
export function DocumentPanel({
  text,
  clauses,
  hoveredClause,
  pinnedClause,
  onClauseHover,
  onClauseClick,
  onScrollContainerRef,
  renderClauseSlot,
  dark,
}: DocumentPanelProps) {
  return (
    <TextDocumentPanel
      text={text}
      clauses={clauses}
      hoveredClause={hoveredClause}
      pinnedClause={pinnedClause}
      onClauseHover={onClauseHover}
      onClauseClick={onClauseClick}
      onScrollContainerRef={onScrollContainerRef}
      renderClauseSlot={renderClauseSlot}
      dark={dark}
    />
  );
}
