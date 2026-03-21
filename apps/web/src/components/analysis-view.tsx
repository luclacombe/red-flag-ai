"use client";

import type { ClauseAnalysis, Recommendation, RiskLevel, Summary } from "@redflag/shared";
import { ChevronDown, Home, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStreamContext } from "@/context/stream-context";
import { useIsDesktop } from "@/hooks/use-media-query";
import { createClient } from "@/lib/supabase/client";
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
import { RiskBadge } from "./risk-badge";
import { StatusBar } from "./status-bar";
import { SummaryPanel } from "./summary-panel";

interface AnalysisViewProps {
  id: string;
}

type ProcessingStep = "connecting" | "gate" | "extracting" | "parsing" | "preparing" | "analyzing";

/** Minimum time (ms) a clause shimmer must be visible before transitioning to its final color */
const MIN_SHIMMER_MS = 400;

const RISK_HEX: Record<RiskLevel, string> = {
  red: "#DC2626",
  yellow: "#E17100",
  green: "#00A73D",
};

const RISK_RGBA: Record<RiskLevel, string> = {
  red: "220, 38, 38",
  yellow: "225, 113, 0",
  green: "0, 167, 61",
};

/** Padding (px) above the auto-scroll target so previous content stays visible */
const SCROLL_PADDING = 20;

/** Scroll target to the TOP of a container (with padding) — never scrolls the page */
function scrollInContainer(container: HTMLElement, target: HTMLElement, padding = SCROLL_PADDING) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const relativeTop = targetRect.top - containerRect.top;
  // Already at the desired top position (within tolerance) — skip
  if (Math.abs(relativeTop - padding) < 20) return;
  // Can't scroll higher — already at top of container
  if (relativeTop < padding && container.scrollTop <= 0) return;
  const desiredScrollTop = container.scrollTop + relativeTop - padding;
  container.scrollTo({ top: Math.max(0, desiredScrollTop), behavior: "smooth" });
}

function getCardShadow(riskLevel: RiskLevel, isPinned: boolean, isHovered: boolean): string {
  const hex = RISK_HEX[riskLevel];
  const rgba = RISK_RGBA[riskLevel];
  const base = `inset 4px 0 0 0 ${hex}`;
  if (isPinned) return `${base}, inset 0 0 0 2px ${hex}, 0 0 12px 2px rgba(${rgba}, 0.35)`;
  if (isHovered) return `${base}, 0 0 8px 1px rgba(${rgba}, 0.2)`;
  return base;
}

export function AnalysisView({ id }: AnalysisViewProps) {
  const stream = useStreamContext();
  const isDesktop = useIsDesktop();

  // Auth state for feature gating (anonymous vs authenticated)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setIsAuthenticated(!!user));
  }, []);

  // Local shimmer-buffered display state — initialized from context for instant navigate-back
  const [displayedClauses, setDisplayedClauses] = useState<ClauseAnalysis[]>(() =>
    stream.analysisId === id ? [...stream.streamClauses] : [],
  );
  const processedPositions = useRef(
    new Set(stream.analysisId === id ? stream.streamClauses.map((c) => c.position) : []),
  );

  const [flashingPosition, setFlashingPosition] = useState<number | null>(null);

  // Hover/click interaction — split to prevent scroll cascade
  const [hoveredClause, setHoveredClause] = useState<number | null>(null);
  const [pinnedClause, setPinnedClause] = useState<number | null>(null);
  const activeClause = pinnedClause ?? hoveredClause;

  // Mobile: expand/collapse inline clause cards (red/yellow auto-expanded, green collapsed)
  const [expandedClauses, setExpandedClauses] = useState<Set<number>>(new Set());
  const toggleClauseExpanded = useCallback((position: number) => {
    setExpandedClauses((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }, []);

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

  // Processing step fade state
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

  // Start streaming when analysis needs it
  const analysisStatus = analysis?.status;
  useEffect(() => {
    if (analysisStatus === "pending" || analysisStatus === "processing") {
      stream.startStream(id);
    }
  }, [analysisStatus, id, stream.startStream]);

  // Best-effort cleanup for anonymous users via sendBeacon
  useEffect(() => {
    if (isAuthenticated) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        navigator.sendBeacon("/api/cleanup", JSON.stringify({ analysisId: id }));
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isAuthenticated, id]);

  // Derived stream state
  const activeStream = stream.analysisId === id;
  const needsStreaming = activeStream && !stream.streamDone;
  const hasStreamResults = activeStream && displayedClauses.length > 0;

  // ── Commit a clause result to display (after minimum shimmer time) ──
  const commitClauseResult = useCallback((result: ClauseAnalysis) => {
    setDisplayedClauses((prev) => {
      if (prev.some((c) => c.position === result.position)) return prev;
      return [...prev, result];
    });
    // Auto-expand red/yellow inline cards on mobile
    if (result.riskLevel !== "green") {
      setExpandedClauses((prev) => new Set(prev).add(result.position));
    }
    setFlashingPosition(result.position);
    setTimeout(() => setFlashingPosition(null), 450);
    shimmerStartTimes.current.delete(result.position);
    pendingResults.current.delete(result.position);
  }, []);

  // Track new analyzing positions → record shimmer start time
  useEffect(() => {
    if (!activeStream) return;
    for (const pos of stream.analyzingPositions) {
      if (!shimmerStartTimes.current.has(pos)) {
        shimmerStartTimes.current.set(pos, Date.now());
      }
    }
  }, [stream.analyzingPositions, activeStream]);

  // Track new stream clauses → apply shimmer timing before committing to displayedClauses
  useEffect(() => {
    if (!activeStream) return;
    for (const clause of stream.streamClauses) {
      if (processedPositions.current.has(clause.position)) continue;
      processedPositions.current.add(clause.position);

      const startTime = shimmerStartTimes.current.get(clause.position);
      const elapsed = startTime ? Date.now() - startTime : MIN_SHIMMER_MS;

      if (elapsed >= MIN_SHIMMER_MS) {
        commitClauseResult(clause);
      } else {
        // Buffer result — let shimmer finish its minimum display time
        pendingResults.current.set(clause.position, clause);
        const remaining = MIN_SHIMMER_MS - elapsed;
        const timer = setTimeout(() => {
          const buffered = pendingResults.current.get(clause.position);
          if (buffered) commitClauseResult(buffered);
          shimmerTimers.current.delete(clause.position);
        }, remaining);
        shimmerTimers.current.set(clause.position, timer);
      }
    }
  }, [stream.streamClauses, activeStream, commitClauseResult]);

  // Cleanup shimmer timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of shimmerTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Effective analyzing positions (includes shimmer buffer for visual consistency)
  const effectiveAnalyzing = useMemo(() => {
    if (!activeStream) return new Set<number>();
    const set = new Set(stream.analyzingPositions);
    for (const c of stream.streamClauses) {
      if (!displayedClauses.some((d) => d.position === c.position)) {
        set.add(c.position);
      }
    }
    return set;
  }, [activeStream, stream.analyzingPositions, stream.streamClauses, displayedClauses]);

  // Processing step — derived from context state (raw, no hold)
  const rawProcessingStep = useMemo((): ProcessingStep => {
    if (!activeStream) return "connecting";
    if (stream.analyzingPositions.size > 0) return "analyzing";
    if (stream.positionedClauses.length > 0) return "preparing";
    if (stream.documentText) return "extracting";
    if (stream.statusMessage) {
      const msg = stream.statusMessage.toLowerCase();
      if (msg.includes("found") || msg.includes("identif") || msg.includes("pars"))
        return "parsing";
      if (msg.includes("extract")) return "extracting";
      if (msg.includes("relevance") || msg.includes("checking")) return "gate";
      if (msg.includes("analyz") || msg.includes("resum")) return "analyzing";
    }
    return "connecting";
  }, [
    activeStream,
    stream.analyzingPositions.size,
    stream.positionedClauses.length,
    stream.documentText,
    stream.statusMessage,
  ]);

  // Hold "preparing" (RAG pattern matching) step for at least 1.5s so users see it
  const MIN_PREPARING_MS = 1500;
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("connecting");
  const preparingStart = useRef(0);
  const preparingHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (preparingHoldTimer.current) {
      clearTimeout(preparingHoldTimer.current);
      preparingHoldTimer.current = null;
    }

    if (rawProcessingStep === "preparing") {
      preparingStart.current = Date.now();
      setProcessingStep("preparing");
    } else if (rawProcessingStep === "analyzing" && preparingStart.current > 0) {
      // Advancing past "preparing" — enforce minimum hold
      const elapsed = Date.now() - preparingStart.current;
      const remaining = MIN_PREPARING_MS - elapsed;
      if (remaining > 0) {
        preparingHoldTimer.current = setTimeout(() => {
          setProcessingStep("analyzing");
          preparingStart.current = 0;
        }, remaining);
      } else {
        setProcessingStep("analyzing");
        preparingStart.current = 0;
      }
    } else {
      setProcessingStep(rawProcessingStep);
    }

    return () => {
      if (preparingHoldTimer.current) {
        clearTimeout(preparingHoldTimer.current);
        preparingHoldTimer.current = null;
      }
    };
  }, [rawProcessingStep]);

  // Fade out processing steps when analysis actually begins (first clause_analyzing event),
  // not when clause_positions arrives — keeps the steps box visible during RAG fetch + Sonnet
  // startup so the first clause shimmer feels shorter.
  useEffect(() => {
    if (activeStream && stream.analyzingPositions.size > 0 && !processingFadingOut) {
      setProcessingFadingOut(true);
    }
  }, [activeStream, stream.analyzingPositions.size, processingFadingOut]);

  // After the CSS fade-out animation completes, hide processing overlay and reveal the grid
  useEffect(() => {
    if (!processingFadingOut) return;
    const timer = setTimeout(() => setProcessingVisible(false), 600);
    return () => clearTimeout(timer);
  }, [processingFadingOut]);

  // Scroll suppression — set isScrolling on scroll events, debounce clear
  // Covers document panel, clause panel, and window scroll
  useEffect(() => {
    const el = docScrollEl;
    const rightEl = rightPanelRef.current;
    const onScroll = () => {
      isScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    };

    el?.addEventListener("scroll", onScroll, { passive: true });
    rightEl?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el?.removeEventListener("scroll", onScroll);
      rightEl?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [docScrollEl]);

  // Detect user interaction — only flag as interacted on upward scroll (away from latest content).
  // If user scrolls back to the bottom, re-engage auto-scroll.
  const lastTouchY = useRef<number | null>(null);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // Scrolling up — user wants to read earlier content
        userHasInteracted.current = true;
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY.current = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? null;
      if (lastTouchY.current !== null && currentY !== null && currentY > lastTouchY.current) {
        // Finger moving down = scrolling up
        userHasInteracted.current = true;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Re-engage auto-scroll when user scrolls near the bottom of the page or clause panel
  useEffect(() => {
    if (stream.streamDone || stream.streamError) return;
    const rightEl = rightPanelRef.current;
    const onWindowScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
      if (nearBottom && userHasInteracted.current) {
        userHasInteracted.current = false;
      }
    };
    const onPanelScroll = () => {
      if (!rightEl) return;
      const nearBottom = rightEl.scrollTop + rightEl.clientHeight >= rightEl.scrollHeight - 200;
      if (nearBottom && userHasInteracted.current) {
        userHasInteracted.current = false;
      }
    };
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    rightEl?.addEventListener("scroll", onPanelScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onWindowScroll);
      rightEl?.removeEventListener("scroll", onPanelScroll);
    };
  }, [stream.streamDone, stream.streamError]);

  // Auto-scroll skeleton into view during streaming (until user takes over)
  useEffect(() => {
    if (userHasInteracted.current || stream.streamDone || stream.streamError) return;
    if (stream.analyzingPositions.size === 0) return;

    if (isDesktop) {
      // Desktop: scroll within panel containers only (prevents progress bar cutoff)
      const rightEl = rightPanelRef.current;
      if (rightEl && skeletonRef.current && rightEl.scrollHeight > rightEl.clientHeight) {
        scrollInContainer(rightEl, skeletonRef.current);
      }
      if (docScrollEl) {
        const minPos = Math.min(...stream.analyzingPositions);
        const clauseEl = docScrollEl.querySelector(`[data-clause-position="${minPos}"]`);
        if (clauseEl instanceof HTMLElement) {
          scrollInContainer(docScrollEl, clauseEl);
        }
      }
    } else {
      // Mobile: scroll inline skeleton into view on the page
      if (skeletonRef.current) {
        skeletonRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [stream.analyzingPositions, stream.streamDone, stream.streamError, docScrollEl, isDesktop]);

  // Smooth scroll to summary when analysis completes
  useEffect(() => {
    if (stream.streamSummary && summaryRef.current) {
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [stream.streamSummary]);

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
    if (!activeStream) return [];
    const highlights: Array<{
      startIndex: number;
      endIndex: number;
      position: number;
      riskLevel: RiskLevel | "analyzing" | "pending" | "flashing";
    }> = [];

    for (const pc of stream.positionedClauses) {
      if (pc.startIndex < 0) continue;
      const analyzed = displayedClauses.find((c) => c.position === pc.position);
      if (analyzed) {
        highlights.push({
          startIndex: pc.startIndex,
          endIndex: pc.endIndex,
          position: pc.position,
          riskLevel: flashingPosition === pc.position ? "flashing" : analyzed.riskLevel,
        });
      } else if (effectiveAnalyzing.has(pc.position)) {
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
  }, [
    activeStream,
    stream.positionedClauses,
    displayedClauses,
    effectiveAnalyzing,
    flashingPosition,
  ]);

  // Build risk level map for connecting lines
  const clauseRiskLevels = useMemo(() => {
    const map = new Map<number, RiskLevel>();
    for (const c of displayedClauses) {
      map.set(c.position, c.riskLevel);
    }
    return map;
  }, [displayedClauses]);

  // Initialize expanded clauses from DB data (red/yellow expanded, green collapsed)
  const expandedInitialized = useRef(false);
  useEffect(() => {
    if (
      analysis?.status === "complete" &&
      analysis.clauses.length > 0 &&
      !expandedInitialized.current
    ) {
      expandedInitialized.current = true;
      const set = new Set<number>();
      for (const c of analysis.clauses) {
        if (c.riskLevel !== "green") set.add(c.position);
      }
      setExpandedClauses(set);
    }
  }, [analysis]);

  // ── LOADING ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0B1120]">
        <NavBar hideHowItWorks />
        <main className="flex min-h-[50vh] items-center justify-center">
          <h1 className="sr-only">Loading analysis</h1>
          <Loader2 className="size-8 animate-spin text-slate-500" />
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
  if (analysis.status === "complete" && !needsStreaming && !hasStreamResults) {
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
              isAuthenticated={isAuthenticated}
            />
          </div>
          {!isAuthenticated && (
            <div className="mb-6 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-center text-sm text-slate-300">
              <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
                Create a free account
              </Link>{" "}
              to save your analyses, share results, and track your contracts.
            </div>
          )}

          {/* Connecting lines — desktop only */}
          {isDesktop && (
            <ConnectingLines
              activeClause={activeClause}
              leftPanelRef={leftPanelRef}
              rightPanelRef={rightPanelRef}
              docScrollContainer={docScrollEl}
              clauseRiskLevels={dbClauseRiskLevels}
            />
          )}

          {/* Layout: desktop side-by-side / mobile inline / no-doc vertical */}
          {hasDocPanel ? (
            isDesktop ? (
              /* ── DESKTOP: side-by-side ── */
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <div
                  ref={leftPanelRef}
                  className="min-w-0 max-h-[80vh] overflow-hidden lg:sticky lg:top-20"
                >
                  <DocumentPanel
                    text={dbDocText}
                    clauses={dbHighlights}
                    hoveredClause={hoveredClause}
                    pinnedClause={pinnedClause}
                    onClauseHover={handleClauseHover}
                    onClauseClick={handleClauseClick}
                    onScrollContainerRef={setDocScrollEl}
                  />
                </div>
                <div
                  ref={rightPanelRef}
                  className="scrollbar-hidden min-w-0 lg:max-h-[80vh] lg:overflow-y-auto lg:rounded-xl lg:border lg:border-white/10 lg:bg-white/[0.02] lg:sticky lg:top-20"
                >
                  <div className="space-y-3 lg:p-4">
                    {dbClauses.map((clause) => {
                      const isGreen = clause.riskLevel === "green";
                      const isPinned = pinnedClause === clause.position;
                      const isHovered = hoveredClause === clause.position && !isPinned;
                      const shadow = getCardShadow(clause.riskLevel, isPinned, isHovered);
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: div wraps complex card content
                        <div
                          key={clause.position}
                          data-card-position={clause.position}
                          className="cursor-pointer rounded-xl transition-all duration-200"
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
                            <GreenClauseCompact clause={clause} boxShadow={shadow} />
                          ) : (
                            <ClauseCard clause={clause} compact boxShadow={shadow} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* ── MOBILE: dark document with inline analysis sections ── */
              <DocumentPanel
                text={dbDocText}
                clauses={dbHighlights}
                hoveredClause={null}
                pinnedClause={null}
                onClauseHover={() => {}}
                onClauseClick={toggleClauseExpanded}
                dark
                renderClauseSlot={(position) => {
                  const clause = dbClauses.find((c) => c.position === position);
                  if (!clause) return null;
                  return (
                    <InlineAnalysisSection
                      clause={clause}
                      isExpanded={expandedClauses.has(position)}
                    />
                  );
                }}
              />
            )
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
  if (analysis.status === "failed" && !needsStreaming && !hasStreamResults) {
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
  const isAnalyzing = needsStreaming;
  const hasDocPanel = activeStream && stream.documentText !== null;
  const allClausesAnalyzed =
    activeStream && stream.totalClauses > 0 && stream.streamClauses.length === stream.totalClauses;
  const showSummarySkeleton = allClausesAnalyzed && !stream.streamSummary && !stream.streamDone;

  const showProcessingSteps = isAnalyzing && processingVisible;

  const progressMessage =
    stream.totalClauses > 0 && displayedClauses.length > 0 && isAnalyzing
      ? `Analyzed ${displayedClauses.length} of ${stream.totalClauses} clauses...`
      : !showProcessingSteps
        ? stream.statusMessage
        : null;

  // Pre-compute for all-positions rendering
  const displayedMap = new Map(displayedClauses.map((c) => [c.position, c]));
  const firstAnalyzingPos = effectiveAnalyzing.size > 0 ? Math.min(...effectiveAnalyzing) : -1;

  return (
    <div className="flex min-h-screen flex-col bg-[#0B1120]">
      <NavBar hideHowItWorks />
      {progressMessage && <StatusBar message={progressMessage} />}
      {stream.totalClauses > 0 && isAnalyzing && (
        <ProgressBar current={displayedClauses.length} total={stream.totalClauses} />
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <h1 className="sr-only">Analyzing contract</h1>

        {/* Processing steps — shown before clauses arrive, fades out gracefully */}
        {showProcessingSteps && (
          <div
            className={`transition-opacity duration-500 ${processingFadingOut ? "opacity-0" : "opacity-100"}`}
          >
            <ProcessingSteps currentStep={processingStep} className="mt-6" />
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
        {activeStream && stream.streamSummary && (
          <div ref={summaryRef}>
            <SummaryPanel summary={stream.streamSummary} animate className="mb-4" />
            <div className="mb-6 flex justify-center">
              <AnalysisActions
                analysisId={id}
                isOwner={analysis?.isOwner ?? false}
                isPublic={analysis?.isPublic ?? false}
                shareExpiresAt={analysis?.shareExpiresAt ?? null}
                isAuthenticated={isAuthenticated}
              />
            </div>
            {!isAuthenticated && (
              <div className="mb-6 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-center text-sm text-slate-300">
                <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
                  Create a free account
                </Link>{" "}
                to save your analyses, share results, and track your contracts.
              </div>
            )}
          </div>
        )}

        {/* Connecting lines — desktop only */}
        {isDesktop && (
          <ConnectingLines
            activeClause={activeClause}
            leftPanelRef={leftPanelRef}
            rightPanelRef={rightPanelRef}
            docScrollContainer={docScrollEl}
            clauseRiskLevels={clauseRiskLevels}
          />
        )}

        {/* Layout: desktop side-by-side / mobile inline / no-doc vertical */}
        {hasDocPanel && stream.totalClauses > 0 ? (
          isDesktop ? (
            /* ── DESKTOP STREAMING: side-by-side ── */
            <div
              className={cn(
                "grid gap-6 transition-opacity duration-500 lg:grid-cols-[1fr_1fr]",
                processingVisible ? "opacity-0" : "opacity-100",
              )}
            >
              {/* Document panel */}
              <div
                ref={leftPanelRef}
                className="min-w-0 max-h-[80vh] overflow-hidden lg:sticky lg:top-20"
              >
                <DocumentPanel
                  text={stream.documentText ?? ""}
                  clauses={clauseHighlights}
                  hoveredClause={hoveredClause}
                  pinnedClause={pinnedClause}
                  onClauseHover={handleClauseHover}
                  onClauseClick={handleClauseClick}
                  onScrollContainerRef={setDocScrollEl}
                />
              </div>

              {/* Analysis cards */}
              <div
                ref={rightPanelRef}
                className="scrollbar-hidden min-w-0 lg:max-h-[80vh] lg:overflow-y-auto lg:rounded-xl lg:border lg:border-white/10 lg:bg-white/[0.02] lg:sticky lg:top-20"
              >
                <div className="space-y-3 lg:p-4">
                  {stream.positionedClauses
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map((pc) => {
                      const clause = displayedMap.get(pc.position);
                      if (clause) {
                        const isGreen = clause.riskLevel === "green";
                        const isPinned = pinnedClause === clause.position;
                        const isHovered = hoveredClause === clause.position && !isPinned;
                        const shadow = getCardShadow(clause.riskLevel, isPinned, isHovered);
                        return (
                          // biome-ignore lint/a11y/useSemanticElements: div wraps complex card content
                          <div
                            key={`pos-${clause.position}`}
                            data-card-position={clause.position}
                            className="cursor-pointer rounded-xl transition-all duration-200"
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
                              <GreenClauseCompact clause={clause} animate boxShadow={shadow} />
                            ) : (
                              <ClauseCard
                                clause={clause}
                                compact
                                animate
                                animationDelay={0}
                                boxShadow={shadow}
                              />
                            )}
                          </div>
                        );
                      }
                      // Not yet analyzed — skeleton (shimmering if analyzing, faint if pending)
                      const isCurrentlyAnalyzing = effectiveAnalyzing.has(pc.position);
                      return (
                        <div
                          key={`skeleton-${pc.position}`}
                          ref={
                            isCurrentlyAnalyzing && pc.position === firstAnalyzingPos
                              ? skeletonRef
                              : undefined
                          }
                          data-card-position={pc.position}
                          style={
                            !processingVisible
                              ? {
                                  animation: `skeleton-enter 400ms ease-out ${pc.position * 40}ms both`,
                                }
                              : undefined
                          }
                        >
                          <ClauseSkeleton analyzing={isCurrentlyAnalyzing} />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : (
            /* ── MOBILE STREAMING: dark document with inline analysis sections ── */
            <div
              className={cn(
                "transition-opacity duration-500",
                processingVisible ? "opacity-0" : "opacity-100",
              )}
            >
              <DocumentPanel
                text={stream.documentText ?? ""}
                clauses={clauseHighlights}
                hoveredClause={null}
                pinnedClause={null}
                onClauseHover={() => {}}
                onClauseClick={toggleClauseExpanded}
                dark
                renderClauseSlot={(position) => {
                  const clause = displayedMap.get(position);
                  if (clause) {
                    return (
                      <div data-card-position={position}>
                        <InlineAnalysisSection
                          clause={clause}
                          isExpanded={expandedClauses.has(position)}
                        />
                      </div>
                    );
                  }
                  // Inline skeleton for currently-analyzing clauses
                  const isCurrentlyAnalyzing = effectiveAnalyzing.has(position);
                  if (!isCurrentlyAnalyzing) return null;
                  return (
                    <div
                      className="mt-2"
                      ref={position === firstAnalyzingPos ? skeletonRef : undefined}
                      data-card-position={position}
                    >
                      <div
                        className="rounded-lg border border-white/[0.06] p-3"
                        style={{
                          background: "rgba(255, 255, 255, 0.03)",
                          boxShadow:
                            "0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-4 w-20 rounded bg-slate-600 skeleton-shimmer" />
                          <div className="h-5 w-16 rounded-full bg-slate-600 skeleton-shimmer" />
                        </div>
                        <div className="mt-2 h-4 w-full rounded bg-slate-600 skeleton-shimmer" />
                        <div className="mt-1.5 h-4 w-4/5 rounded bg-slate-600 skeleton-shimmer" />
                        <p className="text-shimmer mt-2 text-xs font-medium">Analyzing clause...</p>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          )
        ) : stream.totalClauses > 0 ? (
          /* Fallback: vertical stack (no document text) */
          <div className="mx-auto max-w-3xl space-y-4">
            {stream.positionedClauses
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((pc) => {
                const clause = displayedMap.get(pc.position);
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
                const isCurrentlyAnalyzing = effectiveAnalyzing.has(pc.position);
                return (
                  <div
                    key={`skeleton-${pc.position}`}
                    ref={
                      isCurrentlyAnalyzing && pc.position === firstAnalyzingPos
                        ? skeletonRef
                        : undefined
                    }
                    data-card-position={pc.position}
                    style={
                      !processingVisible
                        ? {
                            animation: `skeleton-enter 400ms ease-out ${pc.position * 40}ms both`,
                          }
                        : undefined
                    }
                  >
                    <ClauseSkeleton analyzing={isCurrentlyAnalyzing} />
                  </div>
                );
              })}
          </div>
        ) : null}

        {/* Stream error */}
        {stream.streamError && activeStream && (
          <div className="mx-auto mt-8 max-w-3xl">
            <ErrorState
              message={stream.streamError.message}
              onRetry={stream.streamError.recoverable ? () => window.location.reload() : undefined}
            />
          </div>
        )}
      </main>
      <LegalDisclaimer />
    </div>
  );
}

/**
 * Mobile unified analysis section — always-visible elevated surface with animated body.
 * Header (category + badge + chevron) always visible.
 * Body (explanation + safer alternative) animates via grid-template-rows.
 */
function InlineAnalysisSection({
  clause,
  isExpanded,
}: {
  clause: ClauseAnalysis;
  isExpanded: boolean;
}) {
  const [altExpanded, setAltExpanded] = useState(false);
  const hasSaferAlt = !!clause.saferAlternative && clause.riskLevel !== "green";

  return (
    <div
      className="mt-2 rounded-lg border border-white/[0.06]"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        boxShadow: isExpanded
          ? "0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
        transition: "box-shadow 300ms ease-out",
      }}
    >
      {/* Header — always visible */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {clause.category.replace(/_/g, " ")}
        </span>
        <div className="flex items-center gap-1.5">
          <RiskBadge level={clause.riskLevel} />
          <ChevronDown
            className={cn(
              "size-3.5 text-slate-400 transition-transform duration-300",
              isExpanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Body — animated via grid-template-rows for smooth open + close */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{
          gridTemplateRows: isExpanded ? "1fr" : "0fr",
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3">
            <p className="text-sm leading-relaxed text-slate-300">{clause.explanation}</p>

            {hasSaferAlt && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAltExpanded(!altExpanded);
                  }}
                  className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-green-400 transition-colors duration-150 hover:text-green-300 focus:outline-none"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform duration-150",
                      altExpanded && "rotate-180",
                    )}
                  />
                  Safer alternative
                </button>
                {altExpanded && (
                  <div className="mt-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
                    <p className="text-sm text-green-300">{clause.saferAlternative}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact display for green (safe) clauses — consistent layout with other cards */
function GreenClauseCompact({
  clause,
  animate,
  boxShadow,
}: {
  clause: ClauseAnalysis;
  animate?: boolean;
  boxShadow?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/5 pl-4 pr-3 py-2.5 ${animate ? "animate-[fade-slide-in_200ms_ease-out_both]" : ""}`}
      style={{ boxShadow: boxShadow ?? "inset 4px 0 0 0 #00A73D" }}
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
