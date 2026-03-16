import { analyses, clauses, eq, getDb, getPatternsByContractType, sql } from "@redflag/db";
import {
  type ClauseAnalysis,
  logger,
  type ParsedClause,
  type PositionedClause,
  type SSEEvent,
  type Summary,
} from "@redflag/shared";
import { findAnchorPosition } from "./boundary-detect";
import { analyzeAllClauses } from "./combined-analysis";
import { computeMatchedPatterns } from "./compute-matched-patterns";
import { parseClausesSmart } from "./smart-parse";
import { summarize } from "./summary";

/**
 * Map gate agent contract types to knowledge base contract types.
 * The gate returns specific types (e.g. "residential_lease") but the
 * knowledge base uses broader categories (e.g. "lease").
 */
const RAG_TYPE_MAP: Record<string, string> = {
  residential_lease: "lease",
  commercial_lease: "lease",
  freelance_agreement: "freelance",
  freelance_contract: "freelance",
  employment_agreement: "employment",
  employment_contract: "employment",
  terms_of_service: "tos",
};

export interface AnalyzeContractParams {
  analysisId: string;
  text: string;
  contractType: string;
  language: string;
  responseLanguage: string;
}

/**
 * Compute clause positions by finding each clause's verbatim text in the document.
 * Searches forward from the last found position to handle duplicate clause text.
 */
export function computeClausePositions(
  documentText: string,
  parsedClauses: ParsedClause[],
): PositionedClause[] {
  let searchFrom = 0;
  return parsedClauses.map((clause) => {
    // Primary: exact match
    const idx = documentText.indexOf(clause.text, searchFrom);
    if (idx !== -1) {
      searchFrom = idx + clause.text.length;
      return { ...clause, startIndex: idx, endIndex: idx + clause.text.length };
    }
    // Fallback: whitespace-normalized match (handles PDF extraction variance)
    const normIdx = findAnchorPosition(documentText, clause.text, searchFrom);
    if (normIdx !== -1) {
      searchFrom = normIdx + clause.text.length;
      return { ...clause, startIndex: normIdx, endIndex: normIdx + clause.text.length };
    }
    return { ...clause, startIndex: -1, endIndex: -1 };
  });
}

/** Update analysis status and error message in DB */
async function updateAnalysisStatus(
  analysisId: string,
  status: string,
  errorMessage: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(analyses)
    .set({ status, errorMessage, updatedAt: new Date() })
    .where(eq(analyses.id, analysisId));
}

/** Heartbeat — update updatedAt to signal liveness and prevent stale reclaim */
async function heartbeat(analysisId: string): Promise<void> {
  const db = getDb();
  await db.update(analyses).set({ updatedAt: new Date() }).where(eq(analyses.id, analysisId));
}

/** Map a DB clause row to a ClauseAnalysis event payload */
function clauseRowToAnalysis(row: {
  clauseText: string;
  startIndex: number;
  endIndex: number;
  position: number;
  riskLevel: string;
  explanation: string;
  saferAlternative: string | null;
  category: string;
  matchedPatterns: unknown;
}): ClauseAnalysis {
  return {
    clauseText: row.clauseText,
    startIndex: row.startIndex,
    endIndex: row.endIndex,
    position: row.position,
    riskLevel: row.riskLevel as ClauseAnalysis["riskLevel"],
    explanation: row.explanation,
    saferAlternative: row.saferAlternative ?? null,
    category: row.category,
    matchedPatterns: (row.matchedPatterns as string[]) ?? [],
  };
}

/**
 * Pipeline orchestrator — chains heuristic parse, bulk RAG, and combined
 * streaming analysis into a single pipeline yielding typed SSE events.
 *
 * Pipeline: Gate → Heuristic Parse → Bulk RAG → Combined Analysis (streaming) → [Summary fallback]
 * Total API calls: 3 (gate + combined analysis + optional summary fallback)
 *
 * RESUMABLE: Caches parse results in analyses.parsedClauses and checks for
 * already-analyzed clauses in the DB. If the function was killed mid-pipeline
 * (e.g. Vercel 300s timeout), the next invocation picks up where it left off.
 *
 * HEARTBEAT: Updates analyses.updatedAt after each yielded event to prevent
 * premature stale detection while actively processing.
 *
 * Event sequence:
 *   clause_positions → status → [clause_analysis (×already done)] → clause_analysis (×remaining) → summary
 */
export async function* analyzeContract(params: AnalyzeContractParams): AsyncGenerator<SSEEvent> {
  const { analysisId, text, contractType } = params;
  const language = params.language || "en";
  const responseLanguage = params.responseLanguage || "en";
  const db = getDb();

  logger.info("Pipeline starting", {
    analysisId,
    contractType,
    language,
    responseLanguage,
    textLen: text.length,
  });

  try {
    // ── Check for existing progress ──────────────────────────
    const analysisRows = await db.select().from(analyses).where(eq(analyses.id, analysisId));
    const analysisRow = analysisRows[0];
    const cachedParsed = analysisRow?.parsedClauses as PositionedClause[] | null | undefined;

    const existingClauses = await db
      .select()
      .from(clauses)
      .where(eq(clauses.analysisId, analysisId))
      .orderBy(clauses.position);

    const analyzedPositions = new Set(existingClauses.map((c) => c.position));

    let positionedClauses: PositionedClause[];

    // ── Step 1: Parse (or resume from cache) ─────────────────
    if (cachedParsed && cachedParsed.length > 0) {
      // Resume: parse already completed in a previous invocation
      positionedClauses = cachedParsed;
      logger.info("Resuming from cached parse", {
        clauseCount: positionedClauses.length,
        alreadyAnalyzed: existingClauses.length,
      });

      // Emit clause positions for skeleton cards (even on resume)
      yield {
        type: "clause_positions",
        data: {
          totalClauses: positionedClauses.length,
          clauses: positionedClauses.map((c) => ({ text: c.text, position: c.position })),
        },
      };

      // Replay already-analyzed clauses to the client
      for (const row of existingClauses) {
        yield { type: "clause_analysis", data: clauseRowToAnalysis(row) };
      }

      const remaining = positionedClauses.length - existingClauses.length;
      if (remaining > 0) {
        yield {
          type: "status",
          message: `Resuming: ${existingClauses.length} of ${positionedClauses.length} clauses done. Analyzing ${remaining} remaining...`,
        };
      }
    } else {
      // Fresh parse — heuristic first, LLM fallback if suspicious
      const rawClauses = await parseClausesSmart(text, contractType, language);

      if (rawClauses.length === 0) {
        yield {
          type: "error",
          message: "No clauses could be identified in this document.",
          recoverable: false,
        };
        await updateAnalysisStatus(analysisId, "failed", "No clauses found");
        return;
      }

      positionedClauses = computeClausePositions(text, rawClauses);

      // Cache parse results immediately so they survive function timeout
      try {
        await db
          .update(analyses)
          .set({ parsedClauses: positionedClauses, updatedAt: new Date() })
          .where(eq(analyses.id, analysisId));
      } catch {
        // Non-fatal — we can re-parse if needed
      }

      logger.info("Clauses parsed and cached", { clauseCount: positionedClauses.length });

      // Emit clause positions for frontend skeleton cards
      yield {
        type: "clause_positions",
        data: {
          totalClauses: positionedClauses.length,
          clauses: positionedClauses.map((c) => ({ text: c.text, position: c.position })),
        },
      };

      yield {
        type: "status",
        message: `Found ${positionedClauses.length} clauses. Analyzing...`,
      };
    }

    // ── Step 2: Determine remaining work ─────────────────────
    const remainingClauses = positionedClauses.filter((c) => !analyzedPositions.has(c.position));
    const allAnalyses: ClauseAnalysis[] = existingClauses.map(clauseRowToAnalysis);

    if (remainingClauses.length === 0 && allAnalyses.length > 0) {
      logger.info("All clauses already analyzed, generating summary", {
        clauseCount: allAnalyses.length,
      });
    }

    // ── Step 3: Bulk RAG + parallel embedding + combined analysis ─
    let combinedSummary: Summary | null = null;

    if (remainingClauses.length > 0) {
      // Bulk RAG fetch (single SQL query, <50ms)
      // Try exact contract type first, then mapped base type, then unfiltered
      let ragPatterns = await getPatternsByContractType(contractType);
      if (ragPatterns.length === 0 && RAG_TYPE_MAP[contractType]) {
        logger.info("RAG type fallback", {
          from: contractType,
          to: RAG_TYPE_MAP[contractType],
        });
        ragPatterns = await getPatternsByContractType(RAG_TYPE_MAP[contractType]!);
      }

      // Kick off embedding in parallel for matchedPatterns enrichment
      const embeddingPromise = computeMatchedPatterns(positionedClauses, ragPatterns).catch(
        (err: unknown) => {
          logger.warn("Embedding failed, degrading gracefully", {
            error: err instanceof Error ? err.message : String(err),
          });
          return new Map<number, string[]>();
        },
      );

      // Single streaming analysis call
      for await (const event of analyzeAllClauses({
        clauses: remainingClauses,
        contractType,
        language,
        responseLanguage,
        ragPatterns,
      })) {
        if (event.type === "clause_analysis") {
          allAnalyses.push(event.data);

          // Persist to DB
          try {
            await db.insert(clauses).values({
              analysisId,
              clauseText: event.data.clauseText,
              startIndex: event.data.startIndex,
              endIndex: event.data.endIndex,
              position: event.data.position,
              riskLevel: event.data.riskLevel,
              explanation: event.data.explanation,
              saferAlternative: event.data.saferAlternative,
              category: event.data.category,
              matchedPatterns: event.data.matchedPatterns,
            });
          } catch {
            // DB insert failed — still yield the event to the client
          }
        }
        if (event.type === "summary") {
          combinedSummary = event.data;
        }
        yield event;
        await heartbeat(analysisId);
      }

      // Enrich clauses with matchedPatterns after embedding completes
      const matchedMap = await embeddingPromise;
      for (const [position, patternIds] of matchedMap) {
        try {
          await db
            .update(clauses)
            .set({ matchedPatterns: patternIds })
            .where(
              sql`${clauses.analysisId} = ${analysisId} AND ${clauses.position} = ${position}`,
            );
        } catch {
          // Non-fatal — matchedPatterns is supplementary
        }
      }
    }

    // ── Step 4: Summary (fallback if not from combined call) ──
    if (allAnalyses.length === 0) {
      yield {
        type: "error",
        message: "No clauses could be analyzed successfully.",
        recoverable: false,
      };
      await updateAnalysisStatus(analysisId, "failed", "All clause analyses failed");
      return;
    }

    let summary: Summary;

    if (combinedSummary) {
      summary = combinedSummary;
    } else {
      yield { type: "status", message: "Generating summary..." };

      try {
        const summaryResult = await summarize(
          allAnalyses.map((a) => ({
            riskLevel: a.riskLevel,
            explanation: a.explanation,
            category: a.category,
            clauseText: a.clauseText,
          })),
          contractType,
          language,
          responseLanguage,
        );

        const clauseBreakdown = {
          red: allAnalyses.filter((a) => a.riskLevel === "red").length,
          yellow: allAnalyses.filter((a) => a.riskLevel === "yellow").length,
          green: allAnalyses.filter((a) => a.riskLevel === "green").length,
        };

        summary = { ...summaryResult, clauseBreakdown };
        yield { type: "summary", data: summary };
      } catch {
        yield {
          type: "error",
          message: "Failed to generate summary. Individual clause analyses are still available.",
          recoverable: true,
        };
        await updateAnalysisStatus(analysisId, "failed", "Summary agent failed");
        return;
      }
    }

    // ── Step 5: Persist summary + mark complete ──────────────
    try {
      await db
        .update(analyses)
        .set({
          status: "complete",
          overallRiskScore: summary.overallRiskScore,
          recommendation: summary.recommendation,
          topConcerns: summary.topConcerns,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(analyses.id, analysisId));
    } catch {
      // DB update failed — summary was still yielded to the client
    }

    logger.info("Pipeline complete", {
      overallRiskScore: summary.overallRiskScore,
      recommendation: summary.recommendation,
      totalClauses: allAnalyses.length,
      clauseBreakdown: summary.clauseBreakdown,
    });
  } catch (error) {
    logger.error("Pipeline unrecoverable error", {
      step: "pipeline",
      error: error instanceof Error ? error.message : String(error),
    });
    yield {
      type: "error",
      message: "An unexpected error occurred during analysis.",
      recoverable: false,
    };
    try {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await updateAnalysisStatus(analysisId, "failed", errorMsg);
    } catch {
      // Best effort — ignore DB failure here
    }
  }
}
