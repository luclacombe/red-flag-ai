"use client";

import type { ClauseAnalysis, PositionedClause, Summary } from "@redflag/shared";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { trpc } from "@/trpc/react";

interface StreamContextValue {
  analysisId: string | null;
  streamClauses: ClauseAnalysis[];
  totalClauses: number;
  streamSummary: Summary | null;
  statusMessage: string | null;
  streamError: { message: string; recoverable: boolean } | null;
  streamDone: boolean;
  documentText: string | null;
  positionedClauses: PositionedClause[];
  analyzingPositions: Set<number>;
  startStream: (analysisId: string) => void;
  clearStream: () => void;
}

const StreamContext = createContext<StreamContextValue | null>(null);

export function useStreamContext(): StreamContextValue {
  const ctx = useContext(StreamContext);
  if (!ctx) throw new Error("useStreamContext must be used within StreamProvider");
  return ctx;
}

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [streamClauses, setStreamClauses] = useState<ClauseAnalysis[]>([]);
  const [totalClauses, setTotalClauses] = useState(0);
  const [streamSummary, setStreamSummary] = useState<Summary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<{
    message: string;
    recoverable: boolean;
  } | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const [documentText, setDocumentText] = useState<string | null>(null);
  const [positionedClauses, setPositionedClauses] = useState<PositionedClause[]>([]);
  const [analyzingPositions, setAnalyzingPositions] = useState<Set<number>>(new Set());

  // Ref for stable identity check in startStream
  const analysisIdRef = useRef<string | null>(null);
  analysisIdRef.current = analysisId;

  const resetState = useCallback(() => {
    setStreamClauses([]);
    setTotalClauses(0);
    setStreamSummary(null);
    setStatusMessage(null);
    setStreamError(null);
    setStreamDone(false);
    setDocumentText(null);
    setPositionedClauses([]);
    setAnalyzingPositions(new Set());
  }, []);

  const startStream = useCallback(
    (id: string) => {
      // Same ID — keep current state (whether streaming or done)
      if (id === analysisIdRef.current) return;
      resetState();
      setAnalysisId(id);
    },
    [resetState],
  );

  const clearStream = useCallback(() => {
    resetState();
    setAnalysisId(null);
  }, [resetState]);

  // SSE subscription — lives at layout level, survives navigation
  trpc.analysis.stream.useSubscription(
    { analysisId: analysisId ?? "" },
    {
      enabled: analysisId !== null && !streamDone,
      onData(event: { type: string; [key: string]: unknown }) {
        const e = event as
          | { type: "status"; message: string }
          | {
              type: "clause_positions";
              data: { totalClauses: number; clauses: PositionedClause[] };
            }
          | { type: "document_text"; data: { text: string; fileType: string } }
          | { type: "clause_analyzing"; data: { position: number } }
          | { type: "clause_analysis"; data: ClauseAnalysis }
          | { type: "summary"; data: Summary }
          | {
              type: "error";
              message: string;
              recoverable: boolean;
            };

        switch (e.type) {
          case "status":
            setStatusMessage(e.message);
            break;
          case "document_text":
            setDocumentText(e.data.text);
            break;
          case "clause_positions":
            setTotalClauses(e.data.totalClauses);
            setPositionedClauses(e.data.clauses);
            break;
          case "clause_analyzing":
            setAnalyzingPositions((prev) => new Set(prev).add(e.data.position));
            break;
          case "clause_analysis":
            setStreamClauses((prev) => {
              if (prev.some((c) => c.position === e.data.position)) return prev;
              return [...prev, e.data];
            });
            setAnalyzingPositions((prev) => {
              const next = new Set(prev);
              next.delete(e.data.position);
              return next;
            });
            break;
          case "summary":
            setStreamSummary(e.data);
            setStatusMessage(null);
            setStreamDone(true);
            break;
          case "error":
            setStreamError({ message: e.message, recoverable: e.recoverable });
            setStatusMessage(null);
            setStreamDone(true);
            break;
        }
      },
    },
  );

  return (
    <StreamContext.Provider
      value={{
        analysisId,
        streamClauses,
        totalClauses,
        streamSummary,
        statusMessage,
        streamError,
        streamDone,
        documentText,
        positionedClauses,
        analyzingPositions,
        startStream,
        clearStream,
      }}
    >
      {children}
    </StreamContext.Provider>
  );
}
