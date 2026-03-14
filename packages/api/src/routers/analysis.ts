import { analyzeContract } from "@redflag/agents";
import { analyses, clauses, documents, eq, getDb, sql } from "@redflag/db";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

/** 10 minutes in milliseconds */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Atomically claim an analysis for processing.
 * Returns the analysis row if claimed, null if already claimed by another consumer.
 *
 * Handles both pending analyses and stale processing ones (stuck > 10 min).
 */
async function claimAnalysis(analysisId: string) {
  const db = getDb();
  const result = await db
    .update(analyses)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      sql`${analyses.id} = ${analysisId} AND (${analyses.status} = 'pending' OR (${analyses.status} = 'processing' AND ${analyses.updatedAt} < now() - interval '10 minutes'))`,
    )
    .returning();

  return result[0] ?? null;
}

export const analysisRouter = router({
  /**
   * SSE subscription — streams clause-by-clause analysis events.
   *
   * Dual path:
   * - Complete → replay from DB
   * - Processing (not stale) → yield existing clauses, return
   * - Pending / stale processing → claim and run pipeline
   * - Failed → yield error
   */
  stream: publicProcedure
    .input(z.object({ analysisId: z.string().uuid() }))
    .subscription(async function* ({ input }) {
      const db = getDb();

      const analysisRows = await db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.analysisId));
      const analysis = analysisRows[0];

      if (!analysis) {
        yield { type: "error" as const, message: "Analysis not found.", recoverable: false };
        return;
      }

      // ── COMPLETE → replay from DB ──────────────────────────
      if (analysis.status === "complete") {
        const existingClauses = await db
          .select()
          .from(clauses)
          .where(eq(clauses.analysisId, input.analysisId))
          .orderBy(clauses.position);

        for (const clause of existingClauses) {
          yield {
            type: "clause_analysis" as const,
            data: {
              clauseText: clause.clauseText,
              startIndex: clause.startIndex,
              endIndex: clause.endIndex,
              position: clause.position,
              riskLevel: clause.riskLevel,
              explanation: clause.explanation,
              saferAlternative: clause.saferAlternative ?? null,
              category: clause.category,
              matchedPatterns: (clause.matchedPatterns as string[]) ?? [],
            },
          };
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

      // ── PROCESSING → recovery path ─────────────────────────
      if (analysis.status === "processing") {
        const existingClauses = await db
          .select()
          .from(clauses)
          .where(eq(clauses.analysisId, input.analysisId))
          .orderBy(clauses.position);

        for (const clause of existingClauses) {
          yield {
            type: "clause_analysis" as const,
            data: {
              clauseText: clause.clauseText,
              startIndex: clause.startIndex,
              endIndex: clause.endIndex,
              position: clause.position,
              riskLevel: clause.riskLevel,
              explanation: clause.explanation,
              saferAlternative: clause.saferAlternative ?? null,
              category: clause.category,
              matchedPatterns: (clause.matchedPatterns as string[]) ?? [],
            },
          };
        }

        // Check staleness
        const isStale = Date.now() - analysis.updatedAt.getTime() > STALE_THRESHOLD_MS;
        if (!isStale) {
          yield {
            type: "status" as const,
            message: "Analysis in progress on another connection...",
          };
          return;
        }
        // Fall through to claim stale analysis
      }

      // ── PENDING / STALE → claim and run pipeline ───────────
      const claimed = await claimAnalysis(input.analysisId);
      if (!claimed) {
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
        yield {
          type: "error" as const,
          message: "Document not found.",
          recoverable: false,
        };
        return;
      }

      // Run the pipeline, forwarding all events to the client
      for await (const event of analyzeContract({
        analysisId: input.analysisId,
        text: doc.extractedText,
        contractType: doc.contractType ?? "other",
        language: doc.language ?? "en",
      })) {
        yield event;
      }
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
