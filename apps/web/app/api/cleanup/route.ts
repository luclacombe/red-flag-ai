import { documents, eq, getDb } from "@redflag/db";
import { logger } from "@redflag/shared";
import { decrypt, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

/**
 * Best-effort cleanup of anonymous analysis data.
 * Called via sendBeacon when the user closes/navigates away from the analysis page.
 * Only deletes documents with no userId (anonymous uploads).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { analysisId?: string };
    const analysisId = body.analysisId;

    if (!analysisId || typeof analysisId !== "string") {
      return Response.json({ error: "Missing analysisId" }, { status: 400 });
    }

    const db = getDb();

    // Look up the document via the analysis
    const { analyses } = await import("@redflag/db");
    const analysisRows = await db
      .select({ documentId: analyses.documentId })
      .from(analyses)
      .where(eq(analyses.id, analysisId));

    const analysis = analysisRows[0];
    if (!analysis) {
      return Response.json({ ok: true });
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
    if (!doc || doc.userId !== null) {
      // Not anonymous, or doesn't exist. Don't delete.
      return Response.json({ ok: true });
    }

    // Delete from storage
    try {
      const supabase = getSupabaseClient();
      const masterKey = getMasterKey();
      const docKey = await deriveKey(masterKey, doc.id, "document");
      const decryptedPath = decrypt(doc.storagePath, docKey);
      await supabase.storage.from("contracts").remove([decryptedPath]);
    } catch {
      // Storage cleanup is best-effort
    }

    // Delete document (CASCADE handles analyses + clauses)
    await db.delete(documents).where(eq(documents.id, doc.id));

    logger.info("Anonymous cleanup via sendBeacon", { documentId: doc.id });
    return Response.json({ ok: true });
  } catch (error) {
    logger.error("Cleanup route failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ ok: true });
  }
}
