import type { KnowledgePattern } from "@redflag/shared";
import { describe, expect, it } from "vitest";
import { findTopMatchesInMemory, formatPatternsForPrompt } from "../format-patterns";

// ── formatPatternsForPrompt ──────────────────────────────────────

const samplePatterns: KnowledgePattern[] = [
  {
    id: "p1",
    clausePattern: "Landlord may enter at any time",
    category: "right_of_entry",
    contractType: ["lease"],
    riskLevel: "red",
    whyRisky: "Violates tenant privacy rights",
    saferAlternative: "Landlord may enter with 48 hours notice",
    jurisdictionNotes: "EU",
  },
  {
    id: "p2",
    clausePattern: "No notice required for termination",
    category: "termination",
    contractType: ["lease"],
    riskLevel: "red",
    whyRisky: "One-sided termination rights",
    saferAlternative: "30 days written notice required",
    jurisdictionNotes: "EU",
  },
  {
    id: "p3",
    clausePattern: "Rent increase without cap",
    category: "rent",
    contractType: ["lease"],
    riskLevel: "yellow",
    whyRisky: "Could lead to unaffordable increases",
    saferAlternative: "Annual increase capped at CPI",
    jurisdictionNotes: "NL",
  },
];

describe("formatPatternsForPrompt", () => {
  it("groups patterns by category", () => {
    const output = formatPatternsForPrompt(samplePatterns);
    expect(output).toContain("### Right Of Entry");
    expect(output).toContain("### Termination");
    expect(output).toContain("### Rent");
  });

  it("includes risk level, pattern, why risky, and safer alternative", () => {
    const output = formatPatternsForPrompt(samplePatterns);
    expect(output).toContain("[RED]");
    expect(output).toContain("[YELLOW]");
    expect(output).toContain("Landlord may enter at any time");
    expect(output).toContain("Why: Violates tenant privacy rights");
    expect(output).toContain("Safer: Landlord may enter with 48 hours notice");
  });

  it("returns fallback message for empty patterns", () => {
    const output = formatPatternsForPrompt([]);
    expect(output).toContain("No specific risk patterns available");
  });

  it("produces a token-reasonable output size", () => {
    const output = formatPatternsForPrompt(samplePatterns);
    // 3 patterns should produce roughly 200-600 tokens (~800-2400 chars)
    expect(output.length).toBeGreaterThan(200);
    expect(output.length).toBeLessThan(5000);
  });

  it("starts with the known risk patterns heading", () => {
    const output = formatPatternsForPrompt(samplePatterns);
    expect(output).toMatch(/^## Known Risk Patterns/);
  });
});

// ── findTopMatchesInMemory ───────────────────────────────────────

function makeEmbedding(values: number[]): number[] {
  // Create a simple embedding with known values
  return values;
}

const patternsWithEmbeddings = [
  {
    id: "p1",
    clausePattern: "Pattern A",
    category: "cat_a",
    contractType: ["lease"] as string[],
    riskLevel: "red" as const,
    whyRisky: "Reason A",
    saferAlternative: "Alt A",
    jurisdictionNotes: "EU",
    embedding: makeEmbedding([1, 0, 0]),
  },
  {
    id: "p2",
    clausePattern: "Pattern B",
    category: "cat_b",
    contractType: ["lease"] as string[],
    riskLevel: "yellow" as const,
    whyRisky: "Reason B",
    saferAlternative: "Alt B",
    jurisdictionNotes: "EU",
    embedding: makeEmbedding([0, 1, 0]),
  },
  {
    id: "p3",
    clausePattern: "Pattern C",
    category: "cat_c",
    contractType: ["lease"] as string[],
    riskLevel: "red" as const,
    whyRisky: "Reason C",
    saferAlternative: "Alt C",
    jurisdictionNotes: "EU",
    embedding: makeEmbedding([0.9, 0.1, 0]),
  },
];

describe("findTopMatchesInMemory", () => {
  it("returns patterns above the similarity threshold", () => {
    // Embedding [1,0,0] is identical to pattern p1 → cosine sim = 1.0
    const matches = findTopMatchesInMemory("clause text", [1, 0, 0], patternsWithEmbeddings, 5);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.patternId).toBe("p1");
    expect(matches[0]?.similarity).toBeCloseTo(1.0, 2);
  });

  it("filters out patterns below threshold", () => {
    // Embedding [0,0,1] is orthogonal to all patterns → cosine sim = 0
    const matches = findTopMatchesInMemory("clause text", [0, 0, 1], patternsWithEmbeddings, 5);
    expect(matches).toHaveLength(0);
  });

  it("sorts by similarity descending", () => {
    // Embedding [0.95, 0.05, 0] is close to p1 [1,0,0] and p3 [0.9,0.1,0]
    const matches = findTopMatchesInMemory(
      "clause text",
      [0.95, 0.05, 0],
      patternsWithEmbeddings,
      5,
    );
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // p1 and p3 should both match — verify ordering
    const similarities = matches.map((m) => m.similarity);
    for (let i = 1; i < similarities.length; i++) {
      expect(similarities[i]).toBeLessThanOrEqual(similarities[i - 1] ?? Number.POSITIVE_INFINITY);
    }
  });

  it("respects topK limit", () => {
    const matches = findTopMatchesInMemory(
      "clause text",
      [0.95, 0.05, 0],
      patternsWithEmbeddings,
      1,
    );
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array for empty inputs", () => {
    expect(findTopMatchesInMemory("text", [], patternsWithEmbeddings, 5)).toHaveLength(0);
    expect(findTopMatchesInMemory("text", [1, 0, 0], [], 5)).toHaveLength(0);
  });

  it("skips patterns with mismatched embedding dimensions", () => {
    const base = patternsWithEmbeddings[0];
    const mismatchedPatterns = base ? [{ ...base, embedding: [1, 0] }] : [];
    const matches = findTopMatchesInMemory("clause text", [1, 0, 0], mismatchedPatterns, 5);
    expect(matches).toHaveLength(0);
  });
});
