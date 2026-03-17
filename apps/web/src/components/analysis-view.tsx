"use client";

import type {
  ClauseAnalysis,
  PositionedClause,
  Recommendation,
  RiskLevel,
  Summary,
} from "@redflag/shared";
import { Home } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";
import { AnalysisActions } from "./analysis-actions";
import { ClauseCard } from "./clause-card";
import { ClauseSkeleton } from "./clause-skeleton";
import { ConnectingLines } from "./connecting-lines";
import { DocumentPanel } from "./document-panel";
import { ErrorState } from "./error-state";
import { LegalDisclaimer } from "./legal-disclaimer";
import { NavBar } from "./nav-bar";
import { ProcessingSteps } from "./processing-steps";
import { ProgressBar } from "./progress-bar";
import { StatusBar } from "./status-bar";
import { SummaryPanel } from "./summary-panel";

interface AnalysisViewProps {
  id: string;
}

type ProcessingStep = "connecting" | "gate" | "extracting" | "parsing" | "analyzing";

/** Minimum time (ms) a clause shimmer must be visible before transitioning to its final color */
const MIN_SHIMMER_MS = 400;

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

  // Side-by-side layout state
  const [documentText, setDocumentText] = useState<string | null>(null);
  const [positionedClauses, setPositionedClauses] = useState<PositionedClause[]>([]);
  const [analyzingPositions, setAnalyzingPositions] = useState<Set<number>>(new Set());
  const [flashingPosition, setFlashingPosition] = useState<number | null>(null);

  // Hover/click interaction — split to prevent scroll cascade
  const [hoveredClause, setHoveredClause] = useState<number | null>(null);
  const [pinnedClause, setPinnedClause] = useState<number | null>(null);
  const activeClause = pinnedClause ?? hoveredClause;

  // Scroll suppression — prevent hover from firing during scroll
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Document scroll container — state (not ref) so ConnectingLines re-renders when populated
  const [docScrollEl, setDocScrollEl] = useState<HTMLDivElement | null>(null);

  // Shimmer timing — ensure each clause shimmers visibly before transitioning
  const shimmerStartTimes = useRef(new Map<number, number>());
  const pendingResults = useRef(new Map<number, ClauseAnalysis>());
  const shimmerTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Auto-scroll during streaming — follows progress until user takes over
  const userHasInteracted = useRef(false);
  const skeletonRef = useRef<HTMLDivElement>(null);

  // Processing step tracking
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("connecting");
  const [processingFadingOut, setProcessingFadingOut] = useState(false);
  const [processingVisible, setProcessingVisible] = useState(true);

  const summaryRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

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

  // ── Commit a clause result to display (after minimum shimmer time) ──
  const commitClauseResult = useCallback((result: ClauseAnalysis) => {
    setStreamClauses((prev) => {
      if (prev.some((c) => c.position === result.position)) return prev;
      return [...prev, result];
    });
    setFlashingPosition(result.position);
    setTimeout(() => setFlashingPosition(null), 450);
    setAnalyzingPositions((prev) => {
      const next = new Set(prev);
      next.delete(result.position);
      return next;
    });
    shimmerStartTimes.current.delete(result.position);
    pendingResults.current.delete(result.position);
  }, []);

  trpc.analysis.stream.useSubscription(
    { analysisId: id },
    {
      enabled: needsStreaming,
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
          case "status": {
            setStatusMessage(e.message);
            const msg = e.message.toLowerCase();
            if (msg.includes("relevance") || msg.includes("checking")) {
              setProcessingStep("gate");
            } else if (msg.includes("extract")) {
              setProcessingStep("extracting");
            } else if (msg.includes("found") || msg.includes("identif") || msg.includes("pars")) {
              setProcessingStep("parsing");
            } else if (msg.includes("analyz") || msg.includes("resum")) {
              setProcessingStep("analyzing");
            }
            break;
          }
          case "document_text":
            setDocumentText(e.data.text);
            setProcessingStep("extracting");
            break;
          case "clause_positions":
            setTotalClauses(e.data.totalClauses);
            setPositionedClauses(e.data.clauses);
            setProcessingStep("analyzing");
            break;
          case "clause_analyzing":
            setAnalyzingPositions((prev) => new Set(prev).add(e.data.position));
            shimmerStartTimes.current.set(e.data.position, Date.now());
            break;
          case "clause_analysis": {
            const startTime = shimmerStartTimes.current.get(e.data.position);
            const elapsed = startTime ? Date.now() - startTime : MIN_SHIMMER_MS;

            if (elapsed >= MIN_SHIMMER_MS) {
              commitClauseResult(e.data);
            } else {
              // Buffer result — let shimmer finish its minimum display time
              pendingResults.current.set(e.data.position, e.data);
              const remaining = MIN_SHIMMER_MS - elapsed;
              const timer = setTimeout(() => {
                const buffered = pendingResults.current.get(e.data.position);
                if (buffered) commitClauseResult(buffered);
                shimmerTimers.current.delete(e.data.position);
              }, remaining);
              shimmerTimers.current.set(e.data.position, timer);
            }
            break;
          }
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

  // Cleanup shimmer timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of shimmerTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Fade out processing steps when clauses arrive
  useEffect(() => {
    if (totalClauses > 0 && processingVisible && !processingFadingOut) {
      setProcessingFadingOut(true);
      const timer = setTimeout(() => setProcessingVisible(false), 600);
      return () => clearTimeout(timer);
    }
  }, [totalClauses, processingVisible, processingFadingOut]);

  // Scroll suppression — set isScrolling on scroll events, debounce clear
  useEffect(() => {
    const el = docScrollEl;
    const onScroll = () => {
      isScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    };

    el?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [docScrollEl]);

  // Detect user interaction — wheel/touch only (not programmatic scroll)
  useEffect(() => {
    const onUserInput = () => {
      userHasInteracted.current = true;
    };
    window.addEventListener("wheel", onUserInput, { passive: true });
    window.addEventListener("touchmove", onUserInput, { passive: true });
    return () => {
      window.removeEventListener("wheel", onUserInput);
      window.removeEventListener("touchmove", onUserInput);
    };
  }, []);

  // Auto-scroll skeleton into view during streaming (until user takes over)
  useEffect(() => {
    if (userHasInteracted.current || streamDone || streamError) return;
    if (analyzingPositions.size === 0) return;
    skeletonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [analyzingPositions, streamDone, streamError]);

  // Smooth scroll to summary when analysis completes
  useEffect(() => {
    if (streamSummary && summaryRef.current) {
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [streamSummary]);

  // ── Interaction handlers ──
  const handleClauseHover = useCallback((position: number | null) => {
    if (isScrollingRef.current) return;
    setHoveredClause(position);
  }, []);

  const handleClauseClick = useCallback(
    (position: number) => {
      setPinnedClause((prev) => {
        const newPinned = prev === position ? null : position;

        // Scroll the OTHER panel to show the corresponding element
        if (newPinned !== null) {
          requestAnimationFrame(() => {
            // Scroll clause highlight into view in document panel
            const clauseEl = docScrollEl?.querySelector(`[data-clause-position="${newPinned}"]`);
            clauseEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            // Scroll card into view on the page
            const cardEl = document.querySelector(`[data-card-position="${newPinned}"]`);
            cardEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        }
        return newPinned;
      });
    },
    [docScrollEl],
  );

  // Build clause highlights from positioned clauses + analyzed results
  const clauseHighlights = useMemo(() => {
    const highlights: Array<{
      startIndex: number;
      endIndex: number;
      position: number;
      riskLevel: RiskLevel | "analyzing" | "pending" | "flashing";
    }> = [];

    for (const pc of positionedClauses) {
      if (pc.startIndex < 0) continue;
      const analyzed = streamClauses.find((c) => c.position === pc.position);
      if (analyzed) {
        highlights.push({
          startIndex: pc.startIndex,
          endIndex: pc.endIndex,
          position: pc.position,
          riskLevel: flashingPosition === pc.position ? "flashing" : analyzed.riskLevel,
        });
      } else if (analyzingPositions.has(pc.position)) {
        highlights.push({
          startIndex: pc.startIndex,
          endIndex: pc.endIndex,
          position: pc.position,
          riskLevel: "analyzing",
        });
      } else {
        highlights.push({
          startIndex: pc.startIndex,
          endIndex: pc.endIndex,
          position: pc.position,
          riskLevel: "pending",
        });
      }
    }

    return highlights;
  }, [positionedClauses, streamClauses, analyzingPositions, flashingPosition]);

  // Build risk level map for connecting lines
  const clauseRiskLevels = useMemo(() => {
    const map = new Map<number, RiskLevel>();
    for (const c of streamClauses) {
      map.set(c.position, c.riskLevel);
    }
    return map;
  }, [streamClauses]);

  // ── LOADING ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0B1120]">
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
    const isForbidden = queryError.data?.code === "FORBIDDEN";
    return (
      <div className="flex min-h-screen flex-col bg-[#0B1120]">
        <NavBar hideHowItWorks />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-24">
          {isForbidden ? (
            <>
              <h1 className="font-heading text-2xl font-semibold text-white">
                This analysis is private
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                The owner hasn&apos;t shared this analysis, or the share link has expired.
              </p>
              <Link
                href="/"
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[#0B1120]"
              >
                <Home className="size-4" />
                Back to home
              </Link>
            </>
          ) : (
            <>
              <h1 className="sr-only">Error loading analysis</h1>
              <ErrorState message="Failed to load analysis. Please try again." />
            </>
          )}
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── 404 ──────────────────────────────────────
  if (analysis === null || analysis === undefined) {
    return (
      <div className="flex min-h-screen flex-col bg-[#0B1120]">
        <NavBar hideHowItWorks />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-24">
          <h1 className="font-heading text-2xl font-semibold text-white">Analysis not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            This analysis doesn&apos;t exist or has been removed.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[#0B1120]"
          >
            <Home className="size-4" />
            Back to home
          </Link>
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── COMPLETE (from DB) — side-by-side with document panel ──
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

    const dbDocText = analysis.extractedText;
    const hasDocPanel = !!dbDocText;
    const dbHighlights = dbClauses
      .filter((c) => c.startIndex >= 0)
      .map((c) => ({
        startIndex: c.startIndex,
        endIndex: c.endIndex,
        position: c.position,
        riskLevel: c.riskLevel as RiskLevel | "analyzing" | "pending" | "flashing",
      }));
    const dbClauseRiskLevels = new Map(dbClauses.map((c) => [c.position, c.riskLevel]));

    return (
      <div className="flex min-h-screen flex-col bg-[#0B1120]">
        <NavBar hideHowItWorks />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-heading text-lg font-semibold text-white">
              Contract analysis results
            </h1>
          </div>

          {/* Summary at top */}
          <SummaryPanel summary={completeSummary} className="mb-4" />
          <div className="mb-6 flex justify-center">
            <AnalysisActions
              analysisId={id}
              isOwner={analysis?.isOwner ?? false}
              isPublic={analysis?.isPublic ?? false}
              shareExpiresAt={analysis?.shareExpiresAt ?? null}
            />
          </div>

          {/* Connecting lines — fixed overlay */}
          <ConnectingLines
            activeClause={activeClause}
            leftPanelRef={leftPanelRef}
            rightPanelRef={rightPanelRef}
            docScrollContainer={docScrollEl}
            clauseRiskLevels={dbClauseRiskLevels}
          />

          {/* Side-by-side or vertical */}
          {hasDocPanel ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <div
                ref={leftPanelRef}
                className="min-w-0 max-h-[70vh] overflow-hidden lg:sticky lg:top-20"
              >
                <DocumentPanel
                  text={dbDocText}
                  clauses={dbHighlights}
                  activeClause={activeClause}
                  onClauseHover={handleClauseHover}
                  onClauseClick={handleClauseClick}
                  onScrollContainerRef={setDocScrollEl}
                />
              </div>
              <div ref={rightPanelRef} className="min-w-0 space-y-3">
                {dbClauses.map((clause) => {
                  const isGreen = clause.riskLevel === "green";
                  const isActive = activeClause === clause.position;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: div wraps complex card content
                    <div
                      key={clause.position}
                      data-card-position={clause.position}
                      className={cn(
                        "cursor-pointer rounded-xl transition-all duration-200",
                        isActive && "ring-2 ring-blue-400/40 brightness-110",
                      )}
                      onMouseEnter={() => handleClauseHover(clause.position)}
                      onMouseLeave={() => handleClauseHover(null)}
                      onClick={() => handleClauseClick(clause.position)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleClauseClick(clause.position);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      {isGreen ? (
                        <GreenClauseCompact clause={clause} />
                      ) : (
                        <ClauseCard clause={clause} compact={hasDocPanel} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {dbClauses.map((clause) => (
                <ClauseCard key={clause.position} clause={clause} />
              ))}
            </div>
          )}
        </main>
        <LegalDisclaimer />
      </div>
    );
  }

  // ── FAILED (from DB) ───────────────────────
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
      <div className="flex min-h-screen flex-col bg-[#0B1120]">
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

  // ── STREAMING ──────────────────────────────
  const showSummary = streamSummary !== null;
  const isAnalyzing = !streamDone && !streamError;
  const hasDocPanel = documentText !== null;
  const allClausesAnalyzed = totalClauses > 0 && streamClauses.length === totalClauses;
  const showSummarySkeleton = allClausesAnalyzed && !streamSummary && !streamDone;

  const showProcessingSteps = isAnalyzing && processingVisible;

  const progressMessage =
    totalClauses > 0 && streamClauses.length > 0 && isAnalyzing
      ? `Analyzed ${streamClauses.length} of ${totalClauses} clauses...`
      : !showProcessingSteps
        ? statusMessage
        : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#0B1120]">
      <NavBar hideHowItWorks />
      {progressMessage && <StatusBar message={progressMessage} />}
      {totalClauses > 0 && isAnalyzing && (
        <ProgressBar current={streamClauses.length} total={totalClauses} />
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <h1 className="sr-only">Analyzing contract</h1>

        {/* Processing steps — shown before clauses arrive, fades out gracefully */}
        {showProcessingSteps && (
          <div
            className={`transition-opacity duration-500 ${processingFadingOut ? "opacity-0" : "opacity-100"}`}
          >
            <ProcessingSteps currentStep={processingStep} className="mt-12" />
          </div>
        )}

        {/* Summary skeleton — shown after all clauses analyzed, before summary arrives */}
        {showSummarySkeleton && (
          <div ref={summaryRef} className="mb-4 animate-[fade-slide-in_300ms_ease-out_both]">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:p-6">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <div className="size-[120px] shrink-0 rounded-full bg-slate-700 skeleton-shimmer" />
                <div className="flex flex-1 flex-col items-center gap-3 sm:items-start">
                  <div className="h-5 w-40 rounded bg-slate-700 skeleton-shimmer" />
                  <div className="h-8 w-48 rounded-full bg-slate-700 skeleton-shimmer" />
                </div>
              </div>
              <div className="mt-6">
                <div className="h-4 w-full rounded bg-slate-700 skeleton-shimmer" />
              </div>
              <p className="text-shimmer mt-4 text-center text-sm font-medium">
                Generating risk summary...
              </p>
            </div>
          </div>
        )}

        {/* Summary appears at top when done */}
        {showSummary && (
          <div ref={summaryRef}>
            <SummaryPanel summary={streamSummary} animate className="mb-4" />
            <div className="mb-6 flex justify-center">
              <AnalysisActions
                analysisId={id}
                isOwner={analysis?.isOwner ?? false}
                isPublic={analysis?.isPublic ?? false}
                shareExpiresAt={analysis?.shareExpiresAt ?? null}
              />
            </div>
          </div>
        )}

        {/* Connecting lines — fixed overlay, rendered outside grid */}
        <ConnectingLines
          activeClause={activeClause}
          leftPanelRef={leftPanelRef}
          rightPanelRef={rightPanelRef}
          docScrollContainer={docScrollEl}
          clauseRiskLevels={clauseRiskLevels}
        />

        {/* Side-by-side layout when document text and clause positions are available */}
        {hasDocPanel && totalClauses > 0 ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            {/* Document panel */}
            <div
              ref={leftPanelRef}
              className="min-w-0 max-h-[70vh] overflow-hidden lg:sticky lg:top-20"
            >
              <DocumentPanel
                text={documentText}
                clauses={clauseHighlights}
                activeClause={activeClause}
                onClauseHover={handleClauseHover}
                onClauseClick={handleClauseClick}
                onScrollContainerRef={setDocScrollEl}
              />
            </div>

            {/* Analysis cards */}
            <div ref={rightPanelRef} className="min-w-0 space-y-3">
              {streamClauses
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((clause) => {
                  const isGreen = clause.riskLevel === "green";
                  const isActive = activeClause === clause.position;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: div wraps complex card content
                    <div
                      key={`pos-${clause.position}`}
                      data-card-position={clause.position}
                      className={cn(
                        "cursor-pointer rounded-xl transition-all duration-200",
                        isActive && "ring-2 ring-blue-400/40 brightness-110",
                      )}
                      onMouseEnter={() => handleClauseHover(clause.position)}
                      onMouseLeave={() => handleClauseHover(null)}
                      onClick={() => handleClauseClick(clause.position)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleClauseClick(clause.position);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      {isGreen ? (
                        <GreenClauseCompact clause={clause} animate />
                      ) : (
                        <ClauseCard clause={clause} compact animate animationDelay={0} />
                      )}
                    </div>
                  );
                })}
              {/* Skeleton for currently-analyzing clauses */}
              {isAnalyzing && analyzingPositions.size > 0 && (
                <div ref={skeletonRef}>
                  <ClauseSkeleton analyzing />
                </div>
              )}
            </div>
          </div>
        ) : totalClauses > 0 ? (
          /* Fallback: vertical stack (no document text) */
          <div className="mx-auto max-w-3xl space-y-4">
            {streamClauses
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((clause) => (
                <ClauseCard
                  key={`pos-${clause.position}`}
                  clause={clause}
                  animate
                  animationDelay={0}
                />
              ))}
            {isAnalyzing && analyzingPositions.size > 0 && (
              <div ref={skeletonRef}>
                <ClauseSkeleton analyzing />
              </div>
            )}
          </div>
        ) : null}

        {/* Stream error */}
        {streamError && (
          <div className="mx-auto mt-8 max-w-3xl">
            <ErrorState
              message={streamError.message}
              onRetry={streamError.recoverable ? () => window.location.reload() : undefined}
            />
          </div>
        )}
      </main>
      <LegalDisclaimer />
    </div>
  );
}

/** Compact display for green (safe) clauses — consistent layout with other cards */
function GreenClauseCompact({ clause, animate }: { clause: ClauseAnalysis; animate?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-white/10 border-l-4 border-l-green-600 bg-white/5 px-3 py-2.5 ${animate ? "animate-[fade-slide-in_200ms_ease-out_both]" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {clause.category.replace(/_/g, " ")}
        </span>
        <span className="shrink-0 rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-semibold text-green-400">
          OK
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{clause.explanation}</p>
    </div>
  );
}
