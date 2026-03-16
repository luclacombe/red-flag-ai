import { relevanceGate } from "@redflag/agents";
import { checkRateLimit } from "@redflag/api/rateLimit";
import { analyses, db, documents, eq } from "@redflag/db";
import {
  DOCX_MIME,
  type GateResult,
  logger,
  MAX_FILE_SIZE_BYTES,
  MAX_PAGES,
  MAX_TEXT_LENGTH,
  TXT_MIME,
} from "@redflag/shared";
import { createClient } from "@supabase/supabase-js";
import mammoth from "mammoth";
import { type NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Minimum text length to consider a document as having readable content */
const MIN_TEXT_LENGTH = 50;

/** Magic bytes for a valid PDF file */
const PDF_MAGIC_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

/** Magic bytes for a DOCX file (ZIP/PK header) */
const DOCX_MAGIC_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

type FileType = "pdf" | "docx" | "txt";

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

function detectFileType(mimeType: string): FileType | null {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === DOCX_MIME) return "docx";
  if (mimeType === TXT_MIME) return "txt";
  return null;
}

function getContentType(fileType: FileType): string {
  if (fileType === "pdf") return "application/pdf";
  if (fileType === "docx") return DOCX_MIME;
  return TXT_MIME;
}

async function extractPdfText(
  bytes: Uint8Array,
  filename: string,
): Promise<{ text: string; pageCount: number } | Response> {
  // Magic bytes check
  if (bytes.length < 5 || !PDF_MAGIC_BYTES.every((b, i) => bytes[i] === b)) {
    return errorResponse("Invalid file. The uploaded file is not a valid PDF.", 400);
  }

  try {
    const pdf = await getDocumentProxy(bytes);
    const pageCount = pdf.numPages;
    const { text } = await extractText(pdf, { mergePages: true });

    if (pageCount > MAX_PAGES) {
      return errorResponse(
        `This document has ${pageCount} pages. Maximum is ${MAX_PAGES} pages.`,
        400,
      );
    }

    return { text: String(text), pageCount };
  } catch (extractErr) {
    logger.error("PDF extraction failed", {
      step: "extract",
      filename,
      error: extractErr instanceof Error ? extractErr.message : String(extractErr),
    });
    return errorResponse("We couldn't read this file. Try re-exporting it as a PDF.", 422);
  }
}

async function extractDocxText(
  bytes: Uint8Array,
): Promise<{ text: string; pageCount: number } | Response> {
  // Magic bytes check (PK ZIP header)
  if (bytes.length < 4 || !DOCX_MAGIC_BYTES.every((b, i) => bytes[i] === b)) {
    return errorResponse("Invalid file. The uploaded file is not a valid DOCX document.", 400);
  }

  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = result.value;

    if (text.length > MAX_TEXT_LENGTH) {
      return errorResponse(
        `This document is too long (${text.length.toLocaleString()} characters). Maximum is ${MAX_TEXT_LENGTH.toLocaleString()} characters.`,
        400,
      );
    }

    // Estimate page count from character count (~3000 chars/page)
    const pageCount = Math.max(1, Math.ceil(text.length / 3000));
    return { text, pageCount };
  } catch (extractErr) {
    logger.error("DOCX extraction failed", {
      step: "extract",
      error: extractErr instanceof Error ? extractErr.message : String(extractErr),
    });
    return errorResponse("We couldn't read this file. Make sure it's a valid DOCX document.", 422);
  }
}

function extractTxtText(bytes: Uint8Array): { text: string; pageCount: number } | Response {
  const text = Buffer.from(bytes).toString("utf-8");

  if (text.length > MAX_TEXT_LENGTH) {
    return errorResponse(
      `This document is too long (${text.length.toLocaleString()} characters). Maximum is ${MAX_TEXT_LENGTH.toLocaleString()} characters.`,
      400,
    );
  }

  const pageCount = Math.max(1, Math.ceil(text.length / 3000));
  return { text, pageCount };
}

export async function POST(request: NextRequest) {
  try {
    // ── Rate limit check ────────────────────────────────────────
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";

    try {
      const { limited, resetAt } = await checkRateLimit(ip);
      if (limited) {
        return NextResponse.json(
          { error: "Daily analysis limit reached. Try again tomorrow.", resetAt },
          { status: 429 },
        );
      }
    } catch (rateLimitErr) {
      logger.error("Rate limit check failed", {
        step: "rate_limit",
        error: rateLimitErr instanceof Error ? rateLimitErr.message : String(rateLimitErr),
      });
    }

    // ── Parse multipart form data ──────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");
    const responseLanguage = (formData.get("responseLanguage") as string) || "en";

    if (!file || !(file instanceof File)) {
      return errorResponse("No file provided", 400);
    }

    // ── MIME type check ────────────────────────────────────────
    const fileType = detectFileType(file.type);
    if (!fileType) {
      return errorResponse(
        `Invalid file type. Please upload a PDF, DOCX, or TXT file. (Received: ${file.type || "unknown"})`,
        400,
      );
    }

    // ── Read file bytes ────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // Copy for storage — unpdf/pdf.js detaches the original ArrayBuffer
    const bytesForStorage = new Uint8Array(bytes);

    // ── File size check ────────────────────────────────────────
    if (bytes.length > MAX_FILE_SIZE_BYTES) {
      return errorResponse(
        `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
        400,
      );
    }

    // ── Extract text based on file type ─────────────────────────
    let extractionResult: { text: string; pageCount: number } | Response;

    if (fileType === "pdf") {
      extractionResult = await extractPdfText(bytes, file.name);
    } else if (fileType === "docx") {
      extractionResult = await extractDocxText(bytes);
    } else {
      extractionResult = extractTxtText(bytes);
    }

    // If extraction returned an error response, return it
    if (extractionResult instanceof Response) {
      return extractionResult;
    }

    const { text: extractedText, pageCount } = extractionResult;

    // ── Empty text check ────────────────────────────────────────
    const trimmedText = extractedText.trim();
    if (trimmedText.length === 0) {
      if (fileType === "pdf") {
        return errorResponse(
          "This PDF appears to be a scanned image. Please upload a text-based PDF.",
          422,
        );
      }
      return errorResponse("This document doesn't contain any text to analyze.", 422);
    }

    if (trimmedText.length < MIN_TEXT_LENGTH) {
      return errorResponse("This document doesn't contain enough text to analyze.", 422);
    }

    logger.info("Upload received", {
      filename: file.name,
      fileType,
      pageCount,
      fileSize: bytes.length,
      textLen: trimmedText.length,
    });

    // ── Upload to Supabase Storage ─────────────────────────────
    const supabase = getSupabaseClient();
    const storagePath = `uploads/${crypto.randomUUID()}/${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("contracts")
      .upload(storagePath, bytesForStorage, {
        contentType: getContentType(fileType),
        upsert: false,
      });

    if (uploadError) {
      logger.error("Storage upload failed", { step: "storage", error: uploadError.message });
      return errorResponse("Failed to store the uploaded file.", 500);
    }

    // ── Create document record ─────────────────────────────────
    const [document] = await db
      .insert(documents)
      .values({
        filename: file.name,
        fileType,
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
    } catch (gateErr) {
      logger.error("Gate failed", {
        step: "gate",
        error: gateErr instanceof Error ? gateErr.message : String(gateErr),
      });
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
        responseLanguage,
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
  } catch (err) {
    logger.error("Upload unexpected error", {
      step: "upload",
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse("An unexpected error occurred. Please try again.", 500);
  }
}
