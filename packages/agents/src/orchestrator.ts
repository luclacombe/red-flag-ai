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
import { analyzeClause } from "./risk";
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
 * Pipeline orchestrator — chains all agents and yields typed SSE events.
 *
 * RESUMABLE: Caches parse results in analyses.parsedClauses and checks for
 * already-analyzed clauses in the DB. If the function was killed mid-pipeline
 * (e.g. Vercel 300s timeout), the next invocation picks up where it left off.
 *
 * HEARTBEAT: Updates analyses.updatedAt after each batch to prevent premature
 * stale detection while actively processing.
 *
 * Event sequence:
 *   status → [clause_analysis (×already done)] → status → clause_analysis (×remaining) → status → summary
 */
export async function* analyzeContract(params: AnalyzeContractParams): AsyncGenerator<SSEEvent> {
  const { analysisId, text, contractType } = params;
  const language = params.language || "en";
  const db = getDb();

  logger.info("Pipeline starting", { analysisId, contractType, language, textLen: text.length });

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
      // Fresh parse
      yield { type: "status", message: "Parsing contract clauses..." };

      let rawClauses: ParsedClause[];
      try {
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
      yield {
        type: "status",
        message: `Found ${positionedClauses.length} clauses. Analyzing...`,
      };
    }

    // ── Step 2: Determine remaining work ─────────────────────
    const remainingClauses = positionedClauses.filter((c) => !analyzedPositions.has(c.position));
    const allAnalyses: ClauseAnalysis[] = existingClauses.map(clauseRowToAnalysis);

    if (remainingClauses.length === 0 && allAnalyses.length > 0) {
      // All clauses already analyzed — just need summary
      logger.info("All clauses already analyzed, generating summary", {
        clauseCount: allAnalyses.length,
      });
    }

    // ── Step 3: Batch embed remaining clause texts ───────────
    let embeddings: number[][] | null = null;
    let ragDegraded = false;

    if (remainingClauses.length > 0) {
      try {
        embeddings = await batchEmbed(remainingClauses.map((c) => c.text));
        logger.info("Embeddings complete", { vectorCount: embeddings.length });
      } catch (embedErr) {
        logger.warn("Embeddings failed, degrading gracefully", {
          step: "embed",
          error: embedErr instanceof Error ? embedErr.message : String(embedErr),
        });
        ragDegraded = true;
      }

      await heartbeat(analysisId);
    }

    // ── Step 4: Process remaining clauses in batches ─────────
    const CLAUSE_CONCURRENCY = 5;
    const totalClauses = positionedClauses.length;

    for (
      let batchStart = 0;
      batchStart < remainingClauses.length;
      batchStart += CLAUSE_CONCURRENCY
    ) {
      const batch = remainingClauses.slice(batchStart, batchStart + CLAUSE_CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (clause, batchIdx) => {
          const i = batchIdx;

          let patterns: SimilarPattern[] = [];
          const clauseEmbedding = embeddings?.[batchStart + i];
          if (clauseEmbedding) {
            try {
              patterns = await findSimilarPatterns(clauseEmbedding, {
                topK: 5,
                contractType,
              });
            } catch {
              // DB query failed — continue without patterns
            }
          }

          const riskResult = await analyzeClause(clause, patterns, language);

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
              // Not critical — continue with null alternative
            }
          }

          const matchedPatterns = patterns
            .filter((p) => p.similarity >= PATTERN_MATCH_THRESHOLD)
            .map((p) => p.id);

          return {
            clauseText: clause.text,
            startIndex: Math.max(0, clause.startIndex),
            endIndex: Math.max(1, clause.endIndex),
            position: clause.position,
            riskLevel: riskResult.riskLevel,
            explanation: ragDegraded
              ? `${riskResult.explanation} (Note: analysis performed without knowledge base reference)`
              : riskResult.explanation,
            saferAlternative,
            category: riskResult.category,
            matchedPatterns,
          } satisfies ClauseAnalysis;
        }),
      );

      for (const [batchIdx, result] of batchResults.entries()) {
        if (result.status === "fulfilled") {
          const clauseAnalysis = result.value;

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
          yield { type: "clause_analysis", data: clauseAnalysis };
        } else {
          yield {
            type: "error",
            message: `Failed to analyze clause ${batchStart + batchIdx + 1}. Skipping.`,
            recoverable: true,
          };
        }
      }

      // Heartbeat after each batch + progress status
      await heartbeat(analysisId);
      const doneCount = allAnalyses.length;
      if (doneCount < totalClauses) {
        yield {
          type: "status",
          message: `Analyzed ${doneCount} of ${totalClauses} clauses...`,
        };
      }
    }

    // ── Step 5: Generate summary ──────────────────────────────
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

    // ── Step 6: Persist summary + mark complete ───────────────
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
