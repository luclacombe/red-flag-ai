import type { SimilarPattern } from "@redflag/db";
import { analyses, clauses, embedTexts, eq, findSimilarPatterns, getDb } from "@redflag/db";
import {
  type ClauseAnalysis,
  logger,
  type ParsedClause,
  type PositionedClause,
  type SSEEvent,
  type Summary,
} from "@redflag/shared";
import { parseClauses } from "./parse";
import { rewriteClause } from "./rewrite";
import { analyzeClause, type RiskAnalysisResult } from "./risk";
import { summarize } from "./summary";

/** Similarity threshold for considering a knowledge pattern as "matched" */
const PATTERN_MATCH_THRESHOLD = 0.7;

/** Max texts per Voyage API batch call */
const EMBEDDING_BATCH_LIMIT = 128;

export interface AnalyzeContractParams {
  analysisId: string;
  text: string;
  contractType: string;
  language: string;
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
    const idx = documentText.indexOf(clause.text, searchFrom);
    if (idx === -1) {
      return { ...clause, startIndex: -1, endIndex: -1 };
    }
    searchFrom = idx + clause.text.length;
    return { ...clause, startIndex: idx, endIndex: idx + clause.text.length };
  });
}

/**
 * Batch-embed texts, chunking into groups of 128 to respect Voyage API limits.
 */
async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length <= EMBEDDING_BATCH_LIMIT) {
    return embedTexts(texts, "query");
  }

  const allEmbeddings: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_LIMIT) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_LIMIT);
    const batchEmbeddings = await embedTexts(batch, "query");
    allEmbeddings.push(...batchEmbeddings);
  }
  return allEmbeddings;
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

/**
 * Pipeline orchestrator — chains all agents and yields typed SSE events.
 *
 * Event sequence:
 *   status → status → clause_analysis (×N) → status → summary
 *
 * Each clause is processed sequentially:
 *   findSimilarPatterns → analyzeClause → rewriteClause (if flagged) → persist → yield
 */
export async function* analyzeContract(params: AnalyzeContractParams): AsyncGenerator<SSEEvent> {
  const { analysisId, text, contractType } = params;
  const language = params.language || "en";
  const db = getDb();

  logger.info("Pipeline starting", { analysisId, contractType, language, textLen: text.length });

  try {
    // ── Step 1: Parse contract into clauses ────────────────────
    yield { type: "status", message: "Parsing contract clauses..." };

    let rawClauses: ParsedClause[];
    try {
      // Parse with keepalive — send status events every 15s to prevent SSE timeout
      const parsePromise = parseClauses(text, contractType, language);
      for (;;) {
        const result = await Promise.race([
          parsePromise.then(
            (value) => ({ status: "fulfilled" as const, value }),
            (error: unknown) => ({ status: "rejected" as const, error }),
          ),
          new Promise<{ status: "pending" }>((r) =>
            setTimeout(() => r({ status: "pending" }), 15_000),
          ),
        ]);

        if (result.status === "fulfilled") {
          rawClauses = result.value;
          break;
        }
        if (result.status === "rejected") {
          throw result.error;
        }
        yield { type: "status", message: "Still parsing contract clauses..." };
      }
    } catch (parseErr) {
      logger.error("Parse failed", {
        step: "parse",
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      yield {
        type: "error",
        message: "Failed to parse contract clauses. Please try again.",
        recoverable: true,
      };
      await updateAnalysisStatus(analysisId, "failed", "Parse agent failed");
      return;
    }

    if (rawClauses.length === 0) {
      yield {
        type: "error",
        message: "No clauses could be identified in this document.",
        recoverable: false,
      };
      await updateAnalysisStatus(analysisId, "failed", "No clauses found");
      return;
    }

    // Compute positions via indexOf
    const positionedClauses = computeClausePositions(text, rawClauses);

    logger.info("Clauses parsed", { clauseCount: positionedClauses.length });
    yield {
      type: "status",
      message: `Found ${positionedClauses.length} clauses. Analyzing...`,
    };

    // ── Step 2: Batch embed all clause texts ──────────────────
    let embeddings: number[][] | null = null;
    let ragDegraded = false;

    try {
      embeddings = await batchEmbed(positionedClauses.map((c) => c.text));
      logger.info("Embeddings complete", { vectorCount: embeddings.length });
    } catch (embedErr) {
      logger.warn("Embeddings failed, degrading gracefully", {
        step: "embed",
        error: embedErr instanceof Error ? embedErr.message : String(embedErr),
      });
      ragDegraded = true;
    }

    // ── Step 3: Process each clause ───────────────────────────
    const allAnalyses: ClauseAnalysis[] = [];

    for (const [i, clause] of positionedClauses.entries()) {
      // 3a. Retrieve similar patterns (skip if Voyage failed)
      let patterns: SimilarPattern[] = [];
      const clauseEmbedding = embeddings?.[i];
      if (clauseEmbedding) {
        try {
          patterns = await findSimilarPatterns(clauseEmbedding, {
            topK: 5,
            contractType,
          });
        } catch {
          // DB query failed — continue without patterns for this clause
        }
      }

      // 3b. Run risk analysis
      let riskResult: RiskAnalysisResult;
      try {
        riskResult = await analyzeClause(clause, patterns, language);
      } catch {
        yield {
          type: "error",
          message: `Failed to analyze clause ${i + 1}. Skipping.`,
          recoverable: true,
        };
        continue;
      }

      // 3c. Run rewrite (only for red/yellow)
      let saferAlternative: string | null = null;
      if (riskResult.riskLevel !== "green") {
        try {
          saferAlternative = await rewriteClause(
            clause.text,
            riskResult.riskLevel,
            riskResult.explanation,
            language,
          );
        } catch {
          // Rewrite failed — not critical, continue with null alternative
        }
      }

      // 3d. Compute matched pattern IDs (programmatic, not Claude-reported)
      const matchedPatterns = patterns
        .filter((p) => p.similarity >= PATTERN_MATCH_THRESHOLD)
        .map((p) => p.id);

      // 3e. Clamp positions (handle indexOf = -1 case)
      const startIndex = Math.max(0, clause.startIndex);
      const endIndex = Math.max(1, clause.endIndex);

      // 3f. Build final ClauseAnalysis
      const clauseAnalysis: ClauseAnalysis = {
        clauseText: clause.text,
        startIndex,
        endIndex,
        position: clause.position,
        riskLevel: riskResult.riskLevel,
        explanation: ragDegraded
          ? `${riskResult.explanation} (Note: analysis performed without knowledge base reference)`
          : riskResult.explanation,
        saferAlternative,
        category: riskResult.category,
        matchedPatterns,
      };

      // 3g. Persist to DB
      try {
        await db.insert(clauses).values({
          analysisId,
          clauseText: clauseAnalysis.clauseText,
          startIndex: clauseAnalysis.startIndex,
          endIndex: clauseAnalysis.endIndex,
          position: clauseAnalysis.position,
          riskLevel: clauseAnalysis.riskLevel,
          explanation: clauseAnalysis.explanation,
          saferAlternative: clauseAnalysis.saferAlternative,
          category: clauseAnalysis.category,
          matchedPatterns: clauseAnalysis.matchedPatterns,
        });
      } catch {
        // DB insert failed — still yield the event to the client
      }

      allAnalyses.push(clauseAnalysis);

      // 3h. Stream to client
      yield { type: "clause_analysis", data: clauseAnalysis };
    }

    // ── Step 4: Generate summary ──────────────────────────────
    if (allAnalyses.length === 0) {
      yield {
        type: "error",
        message: "No clauses could be analyzed successfully.",
        recoverable: false,
      };
      await updateAnalysisStatus(analysisId, "failed", "All clause analyses failed");
      return;
    }

    yield { type: "status", message: "Generating summary..." };

    let summary: Summary;
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
      );

      // Compute clause breakdown deterministically
      const clauseBreakdown = {
        red: allAnalyses.filter((a) => a.riskLevel === "red").length,
        yellow: allAnalyses.filter((a) => a.riskLevel === "yellow").length,
        green: allAnalyses.filter((a) => a.riskLevel === "green").length,
      };

      summary = { ...summaryResult, clauseBreakdown };
    } catch {
      yield {
        type: "error",
        message: "Failed to generate summary. Individual clause analyses are still available.",
        recoverable: true,
      };
      await updateAnalysisStatus(analysisId, "failed", "Summary agent failed");
      return;
    }

    // ── Step 5: Persist summary + mark complete ───────────────
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
      // DB update failed — still yield the summary to the client
    }

    logger.info("Pipeline complete", {
      overallRiskScore: summary.overallRiskScore,
      recommendation: summary.recommendation,
      totalClauses: allAnalyses.length,
      clauseBreakdown: summary.clauseBreakdown,
    });
    yield { type: "summary", data: summary };
  } catch (error) {
    // Unrecoverable error
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
