import { analyses, clauses, documents, eq, getDb } from "@redflag/db";
import { logger } from "@redflag/shared";
import { decrypt, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { renderReport } from "./report-document";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const db = getDb();

    const analysisRows = await db.select().from(analyses).where(eq(analyses.id, id));
    const analysis = analysisRows[0];

    if (!analysis) {
      return Response.json({ error: "Analysis not found" }, { status: 404 });
    }

    if (analysis.status !== "complete") {
      return Response.json({ error: "Analysis is not yet complete" }, { status: 400 });
    }

    const docRows = await db.select().from(documents).where(eq(documents.id, analysis.documentId));
    const doc = docRows[0];

    if (!doc) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }

    const clauseRows = await db
      .select()
      .from(clauses)
      .where(eq(clauses.analysisId, id))
      .orderBy(clauses.position);

    // Decrypt encrypted fields
    const masterKey = getMasterKey();
    const docKey = await deriveKey(masterKey, doc.id, "document");
    const clauseKey = await deriveKey(masterKey, doc.id, "clause");

    const decryptedFilename = decrypt(doc.filename, docKey);

    let topConcerns: string[] = [];
    if (analysis.topConcerns) {
      try {
        topConcerns = JSON.parse(decrypt(analysis.topConcerns as string, docKey)) as string[];
      } catch {
        topConcerns = [];
      }
    }

    const breakdown = {
      red: clauseRows.filter((c) => c.riskLevel === "red").length,
      yellow: clauseRows.filter((c) => c.riskLevel === "yellow").length,
      green: clauseRows.filter((c) => c.riskLevel === "green").length,
    };

    const pdfBuffer = await renderReport({
      contractType: doc.contractType ?? "unknown",
      filename: decryptedFilename,
      overallRiskScore: analysis.overallRiskScore ?? 0,
      recommendation: analysis.recommendation ?? "caution",
      topConcerns,
      clauses: clauseRows.map((c) => ({
        position: c.position,
        clauseText: decrypt(c.clauseText, clauseKey),
        riskLevel: c.riskLevel,
        explanation: decrypt(c.explanation, clauseKey),
        saferAlternative: c.saferAlternative ? decrypt(c.saferAlternative, clauseKey) : null,
        category: c.category,
      })),
      generatedAt: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      breakdown,
    });

    const safeFilename = decryptedFilename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="redflag-report-${safeFilename}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    logger.error("PDF report generation failed", {
      analysisId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
