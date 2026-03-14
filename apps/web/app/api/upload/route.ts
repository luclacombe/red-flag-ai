import { relevanceGate } from "@redflag/agents";
import { analyses, db, documents, eq } from "@redflag/db";
import { type GateResult, MAX_FILE_SIZE_BYTES, MAX_PAGES } from "@redflag/shared";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

/** Minimum text length to consider a PDF as having readable content */
const MIN_TEXT_LENGTH = 50;

/** Magic bytes for a valid PDF file */
const PDF_MAGIC_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    // ── Parse multipart form data ──────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return errorResponse("No PDF file provided", 400);
    }

    // ── MIME type check ────────────────────────────────────────
    if (file.type !== "application/pdf") {
      return errorResponse("Invalid file type. Please upload a PDF file.", 400);
    }

    // ── Read file bytes ────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // ── Magic bytes check ──────────────────────────────────────
    if (bytes.length < 5 || !PDF_MAGIC_BYTES.every((b, i) => bytes[i] === b)) {
      return errorResponse("Invalid file. The uploaded file is not a valid PDF.", 400);
    }

    // ── File size check ────────────────────────────────────────
    if (bytes.length > MAX_FILE_SIZE_BYTES) {
      return errorResponse(
        `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
        400,
      );
    }

    // ── Extract text using unpdf ───────────────────────────────
    let extractedText: string;
    let pageCount: number;

    try {
      const pdf = await getDocumentProxy(bytes);
      pageCount = pdf.numPages;
      const { text } = await extractText(pdf, { mergePages: true });
      extractedText = String(text);
    } catch {
      return errorResponse("We couldn't read this file. Try re-exporting it as a PDF.", 422);
    }

    // ── Page count check ───────────────────────────────────────
    if (pageCount > MAX_PAGES) {
      return errorResponse(
        `This document has ${pageCount} pages. Maximum is ${MAX_PAGES} pages.`,
        400,
      );
    }

    // ── Empty text check (scanned/image PDFs) ──────────────────
    const trimmedText = extractedText.trim();
    if (trimmedText.length === 0) {
      return errorResponse(
        "This PDF appears to be a scanned image. Please upload a text-based PDF.",
        422,
      );
    }

    if (trimmedText.length < MIN_TEXT_LENGTH) {
      return errorResponse("This document doesn't contain enough text to analyze.", 422);
    }

    // ── Upload to Supabase Storage ─────────────────────────────
    const supabase = getSupabaseClient();
    const storagePath = `uploads/${crypto.randomUUID()}/${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("contracts")
      .upload(storagePath, bytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return errorResponse("Failed to store the uploaded file.", 500);
    }

    // ── Create document record ─────────────────────────────────
    const [document] = await db
      .insert(documents)
      .values({
        filename: file.name,
        pageCount,
        storagePath,
        extractedText: trimmedText,
      })
      .returning();

    if (!document) {
      return errorResponse("Failed to create document record.", 500);
    }

    // ── Run relevance gate ─────────────────────────────────────
    let gateResult: GateResult;
    try {
      gateResult = await relevanceGate(trimmedText);
    } catch {
      // Gate failure — clean up and return error
      return errorResponse(
        "Analysis temporarily unavailable. Please try again in a few minutes.",
        503,
      );
    }

    // ── Handle gate result ─────────────────────────────────────
    if (!gateResult.isContract) {
      return NextResponse.json({
        isContract: false,
        reason:
          gateResult.reason || "This document does not appear to be a contract or legal agreement.",
      });
    }

    // ── Update document with language and contract type ────────
    await db
      .update(documents)
      .set({
        language: gateResult.language,
        contractType: gateResult.contractType,
      })
      .where(eq(documents.id, document.id));

    // ── Create analysis record ─────────────────────────────────
    const [analysis] = await db
      .insert(analyses)
      .values({
        documentId: document.id,
        status: "pending",
      })
      .returning();

    if (!analysis) {
      return errorResponse("Failed to create analysis record.", 500);
    }

    return NextResponse.json({
      isContract: true,
      analysisId: analysis.id,
      contractType: gateResult.contractType,
      language: gateResult.language,
    });
  } catch {
    return errorResponse("An unexpected error occurred. Please try again.", 500);
  }
}
