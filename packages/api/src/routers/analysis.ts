import { analyzeContract } from "@redflag/agents";
import { analyses, clauses, documents, eq, getDb, sql } from "@redflag/db";
import { type ClauseAnalysis, logger } from "@redflag/shared";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

/** 90 seconds — fast recovery from dead functions while heartbeat keeps active ones alive */
const STALE_THRESHOLD_MS = 90 * 1000;

/**
 * Atomically claim an analysis for processing.
 * Returns the analysis row if claimed, null if already claimed by another consumer.
 *
 * Handles both pending analyses and stale processing ones (stuck > 90s without heartbeat).
 */
async function claimAnalysis(analysisId: string) {
  const db = getDb();
  const result = await db
    .update(analyses)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      sql`${analyses.id} = ${analysisId} AND (${analyses.status} = 'pending' OR (${analyses.status} = 'processing' AND ${analyses.updatedAt} < now() - interval '90 seconds'))`,
    )
    .returning();

  return result[0] ?? null;
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

export const analysisRouter = router({
  /**
   * SSE subscription — streams clause-by-clause analysis events.
   *
   * Dual path:
   * - Complete → replay from DB
   * - Processing (not stale) → replay existing clauses, poll for new ones
   * - Pending / stale processing → claim and run pipeline (resumable)
   * - Failed → yield error
   */
  stream: publicProcedure
    .input(z.object({ analysisId: z.string().uuid() }))
    .subscription(async function* ({ input }) {
      const db = getDb();

      logger.info("SSE subscription started", { analysisId: input.analysisId });

      const analysisRows = await db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.analysisId));
      const analysis = analysisRows[0];

      if (!analysis) {
        logger.warn("Analysis not found", { analysisId: input.analysisId });
        yield { type: "error" as const, message: "Analysis not found.", recoverable: false };
        return;
      }

      logger.info("Analysis status", { analysisId: input.analysisId, status: analysis.status });

      // ── COMPLETE → replay from DB ──────────────────────────
      if (analysis.status === "complete") {
        const existingClauses = await db
          .select()
          .from(clauses)
          .where(eq(clauses.analysisId, input.analysisId))
          .orderBy(clauses.position);

        for (const clause of existingClauses) {
          yield { type: "clause_analysis" as const, data: clauseRowToAnalysis(clause) };
        }

        yield {
          type: "summary" as const,
          data: {
            overallRiskScore: analysis.overallRiskScore ?? 0,
            recommendation: (analysis.recommendation ?? "caution") as
              | "sign"
              | "caution"
              | "do_not_sign",
            topConcerns: (analysis.topConcerns as string[]) ?? [],
            clauseBreakdown: {
              red: existingClauses.filter((c) => c.riskLevel === "red").length,
              yellow: existingClauses.filter((c) => c.riskLevel === "yellow").length,
              green: existingClauses.filter((c) => c.riskLevel === "green").length,
            },
            language: "",
            contractType: "",
          },
        };
        return;
      }

      // ── FAILED → yield error ───────────────────────────────
      if (analysis.status === "failed") {
        yield {
          type: "error" as const,
          message: analysis.errorMessage ?? "Analysis failed.",
          recoverable: true,
        };
        return;
      }

      // ── PROCESSING → replay existing clauses, poll for progress ─
      if (analysis.status === "processing") {
        const isStale = Date.now() - analysis.updatedAt.getTime() > STALE_THRESHOLD_MS;
        if (!isStale) {
          // Another connection is actively processing — replay existing + poll for new
          let lastYieldedCount = 0;

          // Immediately replay any already-analyzed clauses
          const existingClauses = await db
            .select()
            .from(clauses)
            .where(eq(clauses.analysisId, input.analysisId))
            .orderBy(clauses.position);

          for (const clause of existingClauses) {
            yield { type: "clause_analysis" as const, data: clauseRowToAnalysis(clause) };
            lastYieldedCount++;
          }

          if (lastYieldedCount > 0) {
            yield {
              type: "status" as const,
              message: `${lastYieldedCount} clauses analyzed. Waiting for more...`,
            };
          } else {
            yield { type: "status" as const, message: "Analysis in progress..." };
          }

          for (;;) {
            await new Promise((r) => setTimeout(r, 3_000));
            const rows = await db.select().from(analyses).where(eq(analyses.id, input.analysisId));
            const current = rows[0];
            if (!current) return;

            if (current.status === "complete") {
              // Fetch all clauses and yield any we haven't sent yet
              const completedClauses = await db
                .select()
                .from(clauses)
                .where(eq(clauses.analysisId, input.analysisId))
                .orderBy(clauses.position);

              for (const clause of completedClauses.slice(lastYieldedCount)) {
                yield { type: "clause_analysis" as const, data: clauseRowToAnalysis(clause) };
              }

              yield {
                type: "summary" as const,
                data: {
                  overallRiskScore: current.overallRiskScore ?? 0,
                  recommendation: (current.recommendation ?? "caution") as
                    | "sign"
                    | "caution"
                    | "do_not_sign",
                  topConcerns: (current.topConcerns as string[]) ?? [],
                  clauseBreakdown: {
                    red: completedClauses.filter((c) => c.riskLevel === "red").length,
                    yellow: completedClauses.filter((c) => c.riskLevel === "yellow").length,
                    green: completedClauses.filter((c) => c.riskLevel === "green").length,
                  },
                  language: "",
                  contractType: "",
                },
              };
              return;
            }

            if (current.status === "failed") {
              yield {
                type: "error" as const,
                message: current.errorMessage ?? "Analysis failed.",
                recoverable: true,
              };
              return;
            }

            // Check for newly analyzed clauses
            const latestClauses = await db
              .select()
              .from(clauses)
              .where(eq(clauses.analysisId, input.analysisId))
              .orderBy(clauses.position);

            for (const clause of latestClauses.slice(lastYieldedCount)) {
              yield { type: "clause_analysis" as const, data: clauseRowToAnalysis(clause) };
              lastYieldedCount++;
            }

            // Check if it became stale while we were polling
            const nowStale = Date.now() - current.updatedAt.getTime() > STALE_THRESHOLD_MS;
            if (nowStale) break; // Fall through to claim stale analysis

            const total = (current.parsedClauses as unknown[] | null)?.length;
            const progress = total
              ? `Analyzing clauses (${lastYieldedCount} of ${total} done)...`
              : `Analyzing clauses (${lastYieldedCount} done)...`;
            yield { type: "status" as const, message: progress };
          }
        }
        // Fall through to claim stale analysis
      }

      // ── PENDING / STALE → claim and run pipeline ───────────
      const claimed = await claimAnalysis(input.analysisId);
      if (!claimed) {
        logger.info("Analysis already claimed", { analysisId: input.analysisId });
        yield { type: "status" as const, message: "Analysis already in progress." };
        return;
      }

      // Look up the document for text + metadata
      const docRows = await db
        .select()
        .from(documents)
        .where(eq(documents.id, analysis.documentId));
      const doc = docRows[0];

      if (!doc) {
        logger.warn("Document not found", {
          analysisId: input.analysisId,
          documentId: analysis.documentId,
        });
        yield {
          type: "error" as const,
          message: "Document not found.",
          recoverable: false,
        };
        return;
      }

      logger.info("Running pipeline", {
        analysisId: input.analysisId,
        documentId: doc.id,
        textLen: doc.extractedText.length,
        contractType: doc.contractType,
        language: doc.language,
      });

      // Run the pipeline, forwarding all events to the client
      for await (const event of analyzeContract({
        analysisId: input.analysisId,
        text: doc.extractedText,
        contractType: doc.contractType ?? "other",
        language: doc.language ?? "en",
      })) {
        yield event;
      }
      logger.info("Pipeline stream complete", { analysisId: input.analysisId });
    }),

  /**
   * Query — fetch a completed analysis with all its clauses.
   * Used by the results page on refresh (no SSE needed).
   */
  get: publicProcedure
    .input(z.object({ analysisId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();

      const analysisRows = await db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.analysisId));
      const analysis = analysisRows[0];

      if (!analysis) return null;

      const clauseRows = await db
        .select()
        .from(clauses)
        .where(eq(clauses.analysisId, input.analysisId))
        .orderBy(clauses.position);

      return {
        ...analysis,
        clauses: clauseRows,
      };
    }),
});
