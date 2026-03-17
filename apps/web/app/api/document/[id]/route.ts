import { analyses, documents, eq, getDb } from "@redflag/db";
import { DOCX_MIME, TXT_MIME } from "@redflag/shared";
import { decrypt, decryptBuffer, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: DOCX_MIME,
  txt: TXT_MIME,
};

/**
 * Serve decrypted document binary for rendering in the frontend viewer.
 * Owner-only: requires auth and matching userId on the document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: analysisId } = await params;

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = getDb();

  // Look up analysis → document
  const analysisRows = await db.select().from(analyses).where(eq(analyses.id, analysisId));
  const analysis = analysisRows[0];
  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  const docRows = await db.select().from(documents).where(eq(documents.id, analysis.documentId));
  const doc = docRows[0];
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Owner check
  if (doc.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Decrypt storage path
  const masterKey = getMasterKey();
  const docKey = await deriveKey(masterKey, doc.id, "document");
  const storagePath = decrypt(doc.storagePath, docKey);

  // Download encrypted file from Supabase Storage
  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await admin.storage.from("contracts").download(storagePath);
  if (error || !data) {
    return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
  }

  // Decrypt the file buffer
  const encryptedBuffer = Buffer.from(await data.arrayBuffer());
  const decryptedBuffer = decryptBuffer(encryptedBuffer, docKey);

  const contentType = CONTENT_TYPES[doc.fileType] ?? "application/octet-stream";

  return new Response(new Uint8Array(decryptedBuffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
