import { describe, expect, it } from "vitest";
import { computeClausePositions } from "../orchestrator";

describe("computeClausePositions", () => {
  it("finds exact clause positions in document text", () => {
    const doc = "LEASE AGREEMENT\n\n1. RENT. Pay $1000.\n\n2. DEPOSIT. $2000 required.";
    const clauses = [
      { text: "1. RENT. Pay $1000.", position: 0 },
      { text: "2. DEPOSIT. $2000 required.", position: 1 },
    ];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).toBe(doc.indexOf("1. RENT. Pay $1000."));
    expect(result[0]?.endIndex).toBe(
      doc.indexOf("1. RENT. Pay $1000.") + "1. RENT. Pay $1000.".length,
    );
    expect(result[1]?.startIndex).toBe(doc.indexOf("2. DEPOSIT. $2000 required."));
    expect(result[1]?.endIndex).toBe(
      doc.indexOf("2. DEPOSIT. $2000 required.") + "2. DEPOSIT. $2000 required.".length,
    );
  });

  it("returns -1 for clauses not found in text", () => {
    const doc = "Some document text.";
    const clauses = [{ text: "This clause does not exist in the document.", position: 0 }];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).toBe(-1);
    expect(result[0]?.endIndex).toBe(-1);
  });

  it("handles duplicate clause text by searching forward", () => {
    const doc = "Clause A. Clause A. Clause B.";
    const clauses = [
      { text: "Clause A.", position: 0 },
      { text: "Clause A.", position: 1 },
      { text: "Clause B.", position: 2 },
    ];

    const result = computeClausePositions(doc, clauses);

    // First occurrence
    expect(result[0]?.startIndex).toBe(0);
    expect(result[0]?.endIndex).toBe(9);
    // Second occurrence (searches forward from after first)
    expect(result[1]?.startIndex).toBe(10);
    expect(result[1]?.endIndex).toBe(19);
    // Third clause
    expect(result[2]?.startIndex).toBe(20);
  });

  it("handles empty clauses array", () => {
    const result = computeClausePositions("some text", []);
    expect(result).toEqual([]);
  });

  it("preserves text and position fields", () => {
    const doc = "Hello world.";
    const clauses = [{ text: "Hello world.", position: 0 }];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.text).toBe("Hello world.");
    expect(result[0]?.position).toBe(0);
    expect(result[0]?.startIndex).toBe(0);
    expect(result[0]?.endIndex).toBe(12);
  });

  it("handles mixed found and not-found clauses", () => {
    const doc = "Found text here. More text.";
    const clauses = [
      { text: "Found text here.", position: 0 },
      { text: "Missing clause.", position: 1 },
      { text: "More text.", position: 2 },
    ];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).toBe(0);
    expect(result[1]?.startIndex).toBe(-1);
    // "More text." still found because search continues from last found position
    expect(result[2]?.startIndex).toBe(17);
  });

  it("falls back to whitespace-normalized match when exact indexOf fails", () => {
    // Document has extra newlines and spaces (common in PDF extraction)
    const doc = "Section 1\n  The landlord   must\n  provide   24 hours notice before entry.";
    // Clause text has normalized whitespace (collapsed to single spaces)
    const clauseText = "Section 1 The landlord must provide 24 hours notice before entry.";
    const clauses = [{ text: clauseText, position: 0 }];

    const result = computeClausePositions(doc, clauses);

    // Should find via whitespace-normalized fallback, not return -1
    expect(result[0]?.startIndex).toBeGreaterThanOrEqual(0);
    expect(result[0]?.startIndex).not.toBe(-1);
  });
});
