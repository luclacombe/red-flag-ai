import { analyzeContract } from "@redflag/agents";
import { analyses, clauses, documents, eq, getDb, sql } from "@redflag/db";
import { type ClauseAnalysis, logger } from "@redflag/shared";
import { decrypt, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { createClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc";

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

type ClauseRow = {
  clauseText: string;
  startIndex: number;
  endIndex: number;
  position: number;
  riskLevel: string;
  explanation: string;
  saferAlternative: string | null;
  category: string;
  matchedPatterns: unknown;
};

/** Decrypt encrypted clause fields and map to ClauseAnalysis */
function decryptClauseRow(row: ClauseRow, key: Buffer): ClauseAnalysis {
  return {
    clauseText: decrypt(row.clauseText, key),
    startIndex: row.startIndex,
    endIndex: row.endIndex,
    position: row.position,
    riskLevel: row.riskLevel as ClauseAnalysis["riskLevel"],
    explanation: decrypt(row.explanation, key),
    saferAlternative: row.saferAlternative ? decrypt(row.saferAlternative, key) : null,
    category: row.category,
    matchedPatterns: (row.matchedPatterns as string[]) ?? [],
  };
}

/** Decrypt analysis-level encrypted fields */
function decryptAnalysisFields(
  analysis: { topConcerns: string | null; summaryText: string | null },
  key: Buffer,
): { topConcerns: string[]; summaryText: string | null } {
  let topConcerns: string[] = [];
  if (analysis.topConcerns) {
    try {
      topConcerns = JSON.parse(decrypt(analysis.topConcerns, key)) as string[];
    } catch {
      topConcerns = [];
    }
  }
  return {
    topConcerns,
    summaryText: analysis.summaryText ? decrypt(analysis.summaryText, key) : null,
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
    .input(
      z.object({
        analysisId: z.string().uuid(),
        responseLanguage: z.string().optional().default("en"),
      }),
    )
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

      // ── COMPLETE → replay from DB (decrypt) ──────────────────
      if (analysis.status === "complete") {
        // Derive decryption keys
        const masterKey = getMasterKey();
        const clauseKey = await deriveKey(masterKey, analysis.documentId, "clause");
        const docKey = await deriveKey(masterKey, analysis.documentId, "document");

        // Fetch document for text + fileType
        const docRows = await db
          .select()
          .from(documents)
          .where(eq(documents.id, analysis.documentId));
        const doc = docRows[0];

        // Emit document text if available (for side-by-side rendering)
        if (doc) {
          try {
            const decryptedText = decrypt(doc.extractedText, docKey);
            yield {
              type: "document_text" as const,
              data: {
                text: decryptedText,
                fileType: (doc.fileType as "pdf" | "docx" | "txt") ?? "pdf",
              },
            };
          } catch {
            // Decryption failed — skip document text
          }
        }

        const existingClauses = await db
          .select()
          .from(clauses)
          .where(eq(clauses.analysisId, input.analysisId))
          .orderBy(clauses.position);

        const decryptedClauses = existingClauses.map((c) => decryptClauseRow(c, clauseKey));
        const { topConcerns } = decryptAnalysisFields(analysis, docKey);

        // Emit clause positions with full startIndex/endIndex
        yield {
          type: "clause_positions" as const,
          data: {
            totalClauses: decryptedClauses.length,
            clauses: decryptedClauses.map((c) => ({
              text: c.clauseText,
              position: c.position,
              startIndex: c.startIndex,
              endIndex: c.endIndex,
            })),
          },
        };

        for (const clause of decryptedClauses) {
          yield { type: "clause_analysis" as const, data: clause };
        }

        yield {
          type: "summary" as const,
          data: {
            overallRiskScore: analysis.overallRiskScore ?? 0,
            recommendation: (analysis.recommendation ?? "caution") as
              | "sign"
              | "caution"
              | "do_not_sign",
            topConcerns,
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
          // Derive decryption keys for replaying encrypted DB data
          const masterKey = getMasterKey();
          const clauseKey = await deriveKey(masterKey, analysis.documentId, "clause");
          const docKey = await deriveKey(masterKey, analysis.documentId, "document");

          // Another connection is actively processing — replay existing + poll for new
          let lastYieldedCount = 0;

          // Emit clause positions if parse results are cached (encrypted)
          if (analysis.parsedClauses) {
            try {
              const parsed = JSON.parse(
                decrypt(analysis.parsedClauses as string, docKey),
              ) as Array<{
                text: string;
                position: number;
                startIndex: number;
                endIndex: number;
              }>;
              if (parsed.length > 0) {
                yield {
                  type: "clause_positions" as const,
                  data: {
                    totalClauses: parsed.length,
                    clauses: parsed.map((c) => ({
                      text: c.text,
                      position: c.position,
                      startIndex: c.startIndex ?? -1,
                      endIndex: c.endIndex ?? -1,
                    })),
                  },
                };
              }
            } catch {
              // Decryption failed — skip clause positions
            }
          }

          // Immediately replay any already-analyzed clauses
          const existingClauses = await db
            .select()
            .from(clauses)
            .where(eq(clauses.analysisId, input.analysisId))
            .orderBy(clauses.position);

          for (const clause of existingClauses) {
            yield { type: "clause_analysis" as const, data: decryptClauseRow(clause, clauseKey) };
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
              const completedClauses = await db
                .select()
                .from(clauses)
                .where(eq(clauses.analysisId, input.analysisId))
                .orderBy(clauses.position);

              for (const clause of completedClauses.slice(lastYieldedCount)) {
                yield {
                  type: "clause_analysis" as const,
                  data: decryptClauseRow(clause, clauseKey),
                };
              }

              const { topConcerns } = decryptAnalysisFields(current, docKey);

              yield {
                type: "summary" as const,
                data: {
                  overallRiskScore: current.overallRiskScore ?? 0,
                  recommendation: (current.recommendation ?? "caution") as
                    | "sign"
                    | "caution"
                    | "do_not_sign",
                  topConcerns,
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
              yield { type: "clause_analysis" as const, data: decryptClauseRow(clause, clauseKey) };
              lastYieldedCount++;
            }

            // Check if it became stale while we were polling
            const nowStale = Date.now() - current.updatedAt.getTime() > STALE_THRESHOLD_MS;
            if (nowStale) break; // Fall through to claim stale analysis

            // parsedClauses count for progress (encrypted — try decrypt)
            let total: number | null = null;
            if (current.parsedClauses) {
              try {
                const parsed = JSON.parse(decrypt(current.parsedClauses as string, docKey));
                total = (parsed as unknown[]).length;
              } catch {
                // ignore
              }
            }
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

      // Decrypt extractedText for pipeline processing
      const masterKey = getMasterKey();
      const docKey = await deriveKey(masterKey, doc.id, "document");
      const decryptedText = decrypt(doc.extractedText, docKey);

      logger.info("Running pipeline", {
        analysisId: input.analysisId,
        documentId: doc.id,
        textLen: decryptedText.length,
        contractType: doc.contractType,
        language: doc.language,
      });

      // Run the pipeline, forwarding all events to the client
      for await (const event of analyzeContract({
        analysisId: input.analysisId,
        documentId: doc.id,
        text: decryptedText,
        fileType: (doc.fileType as "pdf" | "docx" | "txt") ?? "pdf",
        contractType: doc.contractType ?? "other",
        language: doc.language ?? "en",
        responseLanguage: analysis.responseLanguage ?? input.responseLanguage ?? "en",
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

      // Fetch document for extractedText + fileType
      const docRows = await db
        .select()
        .from(documents)
        .where(eq(documents.id, analysis.documentId));
      const doc = docRows[0];

      const clauseRows = await db
        .select()
        .from(clauses)
        .where(eq(clauses.analysisId, input.analysisId))
        .orderBy(clauses.position);

      // Decrypt encrypted fields
      const masterKey = getMasterKey();
      const docKey = await deriveKey(masterKey, analysis.documentId, "document");
      const clauseKey = await deriveKey(masterKey, analysis.documentId, "clause");

      const decryptedClauses = clauseRows.map((c) => ({
        ...c,
        clauseText: decrypt(c.clauseText, clauseKey),
        explanation: decrypt(c.explanation, clauseKey),
        saferAlternative: c.saferAlternative ? decrypt(c.saferAlternative, clauseKey) : null,
      }));

      const { topConcerns, summaryText } = decryptAnalysisFields(analysis, docKey);

      // Decrypt extractedText from document (for side-by-side rendering)
      let extractedText: string | null = null;
      let fileType: string | null = null;
      if (doc) {
        try {
          extractedText = decrypt(doc.extractedText, docKey);
        } catch {
          // Decryption failed — fall back to no text panel
          extractedText = null;
        }
        fileType = doc.fileType;
      }

      return {
        ...analysis,
        topConcerns,
        summaryText,
        extractedText,
        fileType,
        clauses: decryptedClauses,
      };
    }),

  /**
   * List — paginated list of the authenticated user's analyses.
   * Returns decrypted filenames and basic analysis metadata.
   */
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const masterKey = getMasterKey();

      // Fetch analyses joined with documents for this user, ordered by createdAt DESC
      // Use cursor-based pagination (cursor = analysis.id from the last row)
      const rows = await db
        .select({
          analysisId: analyses.id,
          documentId: analyses.documentId,
          status: analyses.status,
          overallRiskScore: analyses.overallRiskScore,
          recommendation: analyses.recommendation,
          createdAt: analyses.createdAt,
          filename: documents.filename,
          contractType: documents.contractType,
        })
        .from(analyses)
        .innerJoin(documents, eq(analyses.documentId, documents.id))
        .where(
          input.cursor
            ? sql`${documents.userId} = ${ctx.user.id} AND ${analyses.createdAt} < (SELECT created_at FROM analyses WHERE id = ${input.cursor})`
            : sql`${documents.userId} = ${ctx.user.id}`,
        )
        .orderBy(sql`${analyses.createdAt} DESC`)
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;

      // Decrypt filenames
      const decryptedItems = await Promise.all(
        items.map(async (row) => {
          let documentName = "Untitled document";
          try {
            const docKey = await deriveKey(masterKey, row.documentId, "document");
            documentName = decrypt(row.filename, docKey);
          } catch {
            // Pre-encryption data or decryption failure — show fallback
          }
          return {
            id: row.analysisId,
            documentName,
            contractType: row.contractType,
            riskScore: row.overallRiskScore,
            recommendation: row.recommendation as "sign" | "caution" | "do_not_sign" | null,
            status: row.status,
            createdAt: row.createdAt,
          };
        }),
      );

      return {
        items: decryptedItems,
        nextCursor: hasMore ? items[items.length - 1]?.analysisId : undefined,
      };
    }),

  /**
   * Delete — delete an analysis and its associated document + storage file.
   * Verifies ownership before deleting. CASCADE handles analyses + clauses.
   */
  delete: protectedProcedure
    .input(z.object({ analysisId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Look up analysis → document, verify ownership
      const analysisRows = await db
        .select({
          documentId: analyses.documentId,
        })
        .from(analyses)
        .where(eq(analyses.id, input.analysisId));
      const analysis = analysisRows[0];

      if (!analysis) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Analysis not found." });
      }

      const docRows = await db
        .select({
          id: documents.id,
          userId: documents.userId,
          storagePath: documents.storagePath,
        })
        .from(documents)
        .where(eq(documents.id, analysis.documentId));
      const doc = docRows[0];

      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      }

      if (doc.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this analysis." });
      }

      // Decrypt storagePath and delete from Supabase Storage
      const masterKey = getMasterKey();
      try {
        const docKey = await deriveKey(masterKey, doc.id, "document");
        const decryptedPath = decrypt(doc.storagePath, docKey);

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          const serviceClient = createClient(supabaseUrl, serviceKey);
          await serviceClient.storage.from("contracts").remove([decryptedPath]);
        }
      } catch {
        // Storage deletion failed — continue with DB deletion
        logger.warn("Failed to delete storage file", { documentId: doc.id });
      }

      // Delete document — CASCADE handles analyses + clauses
      await db.delete(documents).where(eq(documents.id, doc.id));

      logger.info("Analysis deleted", {
        analysisId: input.analysisId,
        documentId: doc.id,
        userId: ctx.user.id,
      });

      return { ok: true };
    }),
});
