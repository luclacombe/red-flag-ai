import { documents, getDb, rateLimits, sql } from "@redflag/db";
import { logger } from "@redflag/shared";
import { decrypt, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Documents older than 30 days are deleted */
const RETENTION_DAYS = 30;
/** Rate limit rows older than 7 days are deleted */
const RATE_LIMIT_RETENTION_DAYS = 7;

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

export async function GET(request: Request) {
  // Verify CRON_SECRET for Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const supabase = getSupabaseClient();
    const masterKey = getMasterKey();

    // ── Delete old documents (CASCADE handles analyses + clauses) ──
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const oldDocs = await db
      .select({ id: documents.id, storagePath: documents.storagePath })
      .from(documents)
      .where(sql`${documents.createdAt} < ${cutoffDate.toISOString()}`);

    let storageDeleted = 0;
    let storageFailed = 0;

    for (const doc of oldDocs) {
      // Decrypt storagePath to delete from Supabase Storage
      try {
        const docKey = await deriveKey(masterKey, doc.id, "document");
        const decryptedPath = decrypt(doc.storagePath, docKey);
        const { error } = await supabase.storage.from("contracts").remove([decryptedPath]);
        if (error) {
          logger.warn("Storage delete failed", { docId: doc.id, error: error.message });
          storageFailed++;
        } else {
          storageDeleted++;
        }
      } catch {
        // Storage path might be unencrypted (pre-encryption data) or decryption failed
        storageFailed++;
      }
    }

    // Delete document rows (CASCADE deletes analyses + clauses)
    let docsDeleted = 0;
    if (oldDocs.length > 0) {
      await db.delete(documents).where(sql`${documents.createdAt} < ${cutoffDate.toISOString()}`);
      docsDeleted = oldDocs.length;
    }

    // ── Delete old rate limit rows ──────────────────────────────
    const rateCutoff = new Date();
    rateCutoff.setDate(rateCutoff.getDate() - RATE_LIMIT_RETENTION_DAYS);
    const rateCutoffStr = rateCutoff.toISOString().slice(0, 10);

    await db.delete(rateLimits).where(sql`${rateLimits.date} < ${rateCutoffStr}`);
    const rateLimitsDeleted = -1; // Drizzle doesn't expose rowCount for deletes

    logger.info("Cleanup complete", {
      docsDeleted,
      storageDeleted,
      storageFailed,
      rateLimitsDeleted,
    });

    return Response.json({
      ok: true,
      docsDeleted,
      storageDeleted,
      storageFailed,
      rateLimitsDeleted,
    });
  } catch (error) {
    logger.error("Cleanup cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
