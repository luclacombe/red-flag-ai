"use client";

import type { ClauseAnalysis, Recommendation, RiskLevel, Summary } from "@redflag/shared";
import { Home } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/trpc/react";
import { ClauseCard } from "./clause-card";
import { ClauseSkeleton } from "./clause-skeleton";
import { ErrorState } from "./error-state";
import { LegalDisclaimer } from "./legal-disclaimer";
import { NavBar } from "./nav-bar";
import { ProgressBar } from "./progress-bar";
import { StatusBar } from "./status-bar";
import { SummaryPanel } from "./summary-panel";

interface AnalysisViewProps {
  id: string;
}

export function AnalysisView({ id }: AnalysisViewProps) {
  // Streaming state
  const [streamClauses, setStreamClauses] = useState<ClauseAnalysis[]>([]);
  const [totalClauses, setTotalClauses] = useState<number>(0);
  const [streamSummary, setStreamSummary] = useState<Summary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<{
    message: string;
    recoverable: boolean;
  } | null>(null);
  const [streamDone, setStreamDone] = useState(false);

  // Fetch current analysis state
  const {
    data: analysis,
    isLoading,
    error: queryError,
  } = trpc.analysis.get.useQuery({ analysisId: id });

  // Subscribe to SSE when analysis is pending/processing
  const needsStreaming =
    !streamDone &&
    analysis !== undefined &&
    analysis !== null &&
    (analysis.status === "pending" || analysis.status === "processing");

  trpc.analysis.stream.useSubscription(
    { analysisId: id },
    {
      enabled: needsStreaming,
      onData(event: { type: string; [key: string]: unknown }) {
        const e = event as
          | { type: "status"; message: string }
          | { type: "clause_positions"; data: { totalClauses: number } }
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
          case "clause_positions":
            setTotalClauses(e.data.totalClauses);
            break;
          case "clause_analysis":
            setStreamClauses((prev) => {
              if (prev.some((c) => c.position === e.data.position)) return prev;
              return [...prev, e.data];
            });
            break;
          case "summary":
            setStreamSummary(e.data);
            setStatusMessage(null);
            setStreamDone(true);
            break;
          case "error":
            setStreamError({
              message: e.message,
              recoverable: e.recoverable,
            });
            setStatusMessage(null);
            setStreamDone(true);
            break;
        }
      },
    },
  );

  // ── LOADING ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar hideHowItWorks />
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
          <h1 className="sr-only">Loading analysis</h1>
          <ClauseSkeleton />
          <ClauseSkeleton />
          <ClauseSkeleton />
        </main>
      </div>
    );
  }

  // ── QUERY ERROR ──────────────────────────────
  if (queryError) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <NavBar hideHowItWorks />
        <main className="mx-auto max-w-3xl flex-1 px-4 py-16">
          <h1 className="sr-only">Error loading analysis</h1>
          <ErrorState message="Failed to load analysis. Please try again." />
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── 404 ──────────────────────────────────────
  if (analysis === null || analysis === undefined) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <NavBar hideHowItWorks />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-24">
          <h1 className="font-heading text-2xl font-semibold text-slate-900">Analysis not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            This analysis doesn&apos;t exist or has been removed.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
          >
            <Home className="size-4" />
            Back to home
          </Link>
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── COMPLETE (from DB, no animation) ─────────
  if (analysis.status === "complete" && !needsStreaming && streamClauses.length === 0) {
    const dbClauses: ClauseAnalysis[] = analysis.clauses.map((c) => ({
      clauseText: c.clauseText,
      startIndex: c.startIndex,
      endIndex: c.endIndex,
      position: c.position,
      riskLevel: c.riskLevel as RiskLevel,
      explanation: c.explanation,
      saferAlternative: c.saferAlternative ?? null,
      category: c.category,
      matchedPatterns: (c.matchedPatterns as string[]) ?? [],
    }));

    const completeSummary: Summary = {
      overallRiskScore: analysis.overallRiskScore ?? 0,
      recommendation: (analysis.recommendation ?? "caution") as Recommendation,
      topConcerns: (analysis.topConcerns as string[]) ?? [],
      clauseBreakdown: {
        red: dbClauses.filter((c) => c.riskLevel === "red").length,
        yellow: dbClauses.filter((c) => c.riskLevel === "yellow").length,
        green: dbClauses.filter((c) => c.riskLevel === "green").length,
      },
      language: "",
      contractType: "",
    };

    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <NavBar hideHowItWorks />
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-8">
          <h1 className="sr-only">Contract analysis results</h1>
          {dbClauses.map((clause) => (
            <ClauseCard key={clause.position} clause={clause} />
          ))}
          <SummaryPanel summary={completeSummary} className="mt-8" />
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── FAILED (from DB, no streaming started) ───
  if (analysis.status === "failed" && !needsStreaming && streamClauses.length === 0) {
    const failedClauses: ClauseAnalysis[] = analysis.clauses.map((c) => ({
      clauseText: c.clauseText,
      startIndex: c.startIndex,
      endIndex: c.endIndex,
      position: c.position,
      riskLevel: c.riskLevel as RiskLevel,
      explanation: c.explanation,
      saferAlternative: c.saferAlternative ?? null,
      category: c.category,
      matchedPatterns: (c.matchedPatterns as string[]) ?? [],
    }));

    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <NavBar hideHowItWorks />
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-8">
          <h1 className="sr-only">Analysis failed</h1>
          {failedClauses.map((clause) => (
            <ClauseCard key={clause.position} clause={clause} />
          ))}
          <ErrorState
            message={analysis.errorMessage ?? "Analysis could not be completed."}
            onRetry={() => {
              window.location.href = "/";
            }}
          />
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── STREAMING ────────────────────────────────
  const showSummary = streamSummary !== null;
  const isAnalyzing = !streamDone && !streamError;

  // Compute progress status message from state (avoids stale closure in event handler)
  const progressMessage =
    totalClauses > 0 && streamClauses.length > 0 && isAnalyzing
      ? `Analyzed ${streamClauses.length} of ${totalClauses} clauses...`
      : statusMessage;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <NavBar hideHowItWorks />
      {progressMessage && <StatusBar message={progressMessage} />}
      {totalClauses > 0 && isAnalyzing && (
        <ProgressBar current={streamClauses.length} total={totalClauses} />
      )}
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-8">
        <h1 className="sr-only">Analyzing contract</h1>

        {/* Render all positions: analyzed clauses as ClauseCards, pending as skeletons */}
        {totalClauses > 0 ? (
          Array.from({ length: totalClauses }, (_, position) => {
            const clause = streamClauses.find((c) => c.position === position);
            if (clause) {
              return (
                <ClauseCard
                  key={`pos-${clause.position}`}
                  clause={clause}
                  animate
                  animationDelay={0}
                />
              );
            }
            // biome-ignore lint/suspicious/noArrayIndexKey: position is a stable clause identifier, not an array index
            return isAnalyzing ? <ClauseSkeleton key={position} /> : null;
          })
        ) : (
          <>
            {/* Before clause_positions arrives, show analyzed clauses + generic skeletons */}
            {streamClauses.map((clause, index) => (
              <ClauseCard
                key={clause.position}
                clause={clause}
                animate
                animationDelay={index * 30}
              />
            ))}
            {isAnalyzing && (
              <>
                <ClauseSkeleton />
                {streamClauses.length < 2 && <ClauseSkeleton />}
                {streamClauses.length === 0 && <ClauseSkeleton />}
              </>
            )}
          </>
        )}

        {/* Summary panel */}
        {showSummary && <SummaryPanel summary={streamSummary} animate className="mt-8" />}

        {/* Stream error */}
        {streamError && (
          <ErrorState
            message={streamError.message}
            onRetry={streamError.recoverable ? () => window.location.reload() : undefined}
          />
        )}
      </main>
      <LegalDisclaimer />
    </div>
  );
}
