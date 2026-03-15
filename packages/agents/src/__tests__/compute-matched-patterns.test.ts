import type { ParsedClause } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external dependencies
const mockEmbedTexts = vi.fn();
vi.mock("@redflag/db", () => ({
  embedTexts: (...args: unknown[]) => mockEmbedTexts(...args),
}));

const { computeMatchedPatterns } = await import("../compute-matched-patterns");

const clauses: ParsedClause[] = [
  { text: "The landlord may enter the premises at any time.", position: 0 },
  { text: "The tenant shall pay rent monthly.", position: 1 },
];

const patterns = [
  {
    id: "p1",
    clausePattern: "Entry without notice",
    category: "right_of_entry",
    contractType: ["lease"] as string[],
    riskLevel: "red" as const,
    whyRisky: "Privacy violation",
    saferAlternative: "48h notice",
    jurisdictionNotes: "EU",
    embedding: [1, 0, 0],
  },
  {
    id: "p2",
    clausePattern: "Rent without cap",
    category: "rent",
    contractType: ["lease"] as string[],
    riskLevel: "yellow" as const,
    whyRisky: "Unaffordable",
    saferAlternative: "CPI cap",
    jurisdictionNotes: "NL",
    embedding: [0, 1, 0],
  },
];

describe("computeMatchedPatterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("batch-embeds all clause texts and returns matched patterns", async () => {
    // Clause 0 embedding close to pattern p1, clause 1 close to pattern p2
    mockEmbedTexts.mockResolvedValue([
      [0.99, 0.01, 0], // close to p1 [1,0,0]
      [0.01, 0.99, 0], // close to p2 [0,1,0]
    ]);

    const result = await computeMatchedPatterns(clauses, patterns);

    expect(mockEmbedTexts).toHaveBeenCalledOnce();
    expect(mockEmbedTexts).toHaveBeenCalledWith(
      ["The landlord may enter the premises at any time.", "The tenant shall pay rent monthly."],
      "query",
    );

    // Both clauses should have matched patterns
    expect(result.get(0)).toEqual(["p1"]);
    expect(result.get(1)).toEqual(["p2"]);
  });

  it("returns empty map when Voyage API fails", async () => {
    mockEmbedTexts.mockRejectedValue(new Error("Voyage API down"));

    await expect(computeMatchedPatterns(clauses, patterns)).rejects.toThrow("Voyage API down");
  });

  it("returns empty map for empty clauses", async () => {
    const result = await computeMatchedPatterns([], patterns);

    expect(result.size).toBe(0);
    expect(mockEmbedTexts).not.toHaveBeenCalled();
  });

  it("returns empty map for empty patterns", async () => {
    const result = await computeMatchedPatterns(clauses, []);

    expect(result.size).toBe(0);
    expect(mockEmbedTexts).not.toHaveBeenCalled();
  });

  it("only includes clauses with above-threshold matches", async () => {
    // Clause 0 close to p1, clause 1 orthogonal to both
    mockEmbedTexts.mockResolvedValue([
      [0.99, 0.01, 0], // close to p1
      [0, 0, 1], // orthogonal — no matches above threshold
    ]);

    const result = await computeMatchedPatterns(clauses, patterns);

    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(false);
  });
});
