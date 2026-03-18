import { timingSafeEqual } from "node:crypto";
import { documents, getDb, rateLimits, sql } from "@redflag/db";
import { logger } from "@redflag/shared";
import { decrypt, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Rate limit rows older than 7 days are deleted */
const RATE_LIMIT_RETENTION_DAYS = 7;

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

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

  if (!cronSecret || !authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const supabase = getSupabaseClient();
    const masterKey = getMasterKey();

    // ── Delete old documents (CASCADE handles analyses + clauses) ──
    // If expires_at is set (user renewed), use that; otherwise use created_at + 30 days
    const now = new Date().toISOString();

    const oldDocs = await db
      .select({ id: documents.id, storagePath: documents.storagePath })
      .from(documents)
      .where(
        sql`COALESCE(${documents.expiresAt}, ${documents.createdAt} + INTERVAL '30 days') < ${now}`,
      );

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
      await db
        .delete(documents)
        .where(
          sql`COALESCE(${documents.expiresAt}, ${documents.createdAt} + INTERVAL '30 days') < ${now}`,
        );
      docsDeleted = oldDocs.length;
    }

    // ── Delete old rate limit rows ──────────────────────────────
    const rateCutoff = new Date();
    rateCutoff.setDate(rateCutoff.getDate() - RATE_LIMIT_RETENTION_DAYS);
    const rateCutoffStr = rateCutoff.toISOString().slice(0, 10);

    const oldRateLimits = await db
      .select({ ip: rateLimits.ipAddress })
      .from(rateLimits)
      .where(sql`${rateLimits.date} < ${rateCutoffStr}`);
    if (oldRateLimits.length > 0) {
      await db.delete(rateLimits).where(sql`${rateLimits.date} < ${rateCutoffStr}`);
    }
    const rateLimitsDeleted = oldRateLimits.length;

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
