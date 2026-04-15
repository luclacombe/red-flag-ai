import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { generateMinimalPdf, SAMPLE_CONTRACT_TEXT } from "./fixtures/generate-pdf";

describe("PDF text extraction", { timeout: 30_000 }, () => {
  it("extracts text from a minimal PDF", async () => {
    const pdfBytes = generateMinimalPdf(SAMPLE_CONTRACT_TEXT);
    const pdf = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(pdf, { mergePages: true });

    expect(text).toContain("RESIDENTIAL LEASE AGREEMENT");
  });

  it("reports correct page count", async () => {
    const pdfBytes = generateMinimalPdf("Hello world");
    const pdf = await getDocumentProxy(pdfBytes);

    expect(pdf.numPages).toBe(1);
  });

  it("handles empty text content", async () => {
    const pdfBytes = generateMinimalPdf("");
    const pdf = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(pdf, { mergePages: true });

    expect(String(text).trim().length).toBe(0);
  });
});
