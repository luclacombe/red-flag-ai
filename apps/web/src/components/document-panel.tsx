"use client";

import type { RiskLevel } from "@redflag/shared";
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
  /** Currently active (hovered/clicked) clause position */
  activeClause: number | null;
  /** Callback when user interacts with a clause */
  onClauseHover: (position: number | null) => void;
  onClauseClick: (position: number) => void;
  /** Callback ref to expose the inner scrollable container */
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
}

/**
 * Document panel dispatcher.
 * Currently renders TextDocumentPanel for all file types.
 * Future: PdfViewer for PDFs when react-pdf is integrated.
 */
export function DocumentPanel({
  text,
  clauses,
  activeClause,
  onClauseHover,
  onClauseClick,
  onScrollContainerRef,
}: DocumentPanelProps) {
  return (
    <TextDocumentPanel
      text={text}
      clauses={clauses}
      activeClause={activeClause}
      onClauseHover={onClauseHover}
      onClauseClick={onClauseClick}
      onScrollContainerRef={onScrollContainerRef}
    />
  );
}
