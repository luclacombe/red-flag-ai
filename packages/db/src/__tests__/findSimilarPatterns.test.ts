import { VOYAGE_DIMENSIONS } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the client module before importing findSimilarPatterns
vi.mock("../client", () => {
  const mockExecute = vi.fn();
  return {
    getDb: vi.fn(() => ({
      execute: mockExecute,
    })),
    __mockExecute: mockExecute,
  };
});

// Import after mock setup
const { findSimilarPatterns } = await import("../queries/findSimilarPatterns");
const { __mockExecute } = (await import("../client")) as unknown as {
  __mockExecute: ReturnType<typeof vi.fn>;
};

function mockEmbedding(): number[] {
  return Array.from({ length: VOYAGE_DIMENSIONS }, () => 0.5);
}

/** Extract string literal chunks from Drizzle SQL template (skips column refs) */
function extractSqlStrings(sqlObj: unknown): string {
  if (sqlObj == null) return "";
  if (typeof sqlObj === "string") return sqlObj;
  if (Array.isArray(sqlObj)) return sqlObj.map(extractSqlStrings).join("");
  if (typeof sqlObj === "object") {
    const obj = sqlObj as Record<string, unknown>;
    if (obj.queryChunks) return extractSqlStrings(obj.queryChunks);
    // StringChunk: has `value` that is a string array of raw SQL fragments
    if (obj.value && Array.isArray(obj.value) && obj.value.every((v) => typeof v === "string"))
      return (obj.value as string[]).join("");
  }
  return "";
}

const sampleRow = {
  id: "a1b2c3d4-1001-4a00-b000-000000000001",
  clause_pattern: "Landlord may enter at any time",
  category: "right_of_entry",
  contract_type: ["lease"],
  risk_level: "red",
  why_risky: "Violates tenant privacy rights",
  safer_alternative: "Landlord may enter with 48 hours notice",
  jurisdiction_notes: "EU Directive 93/13/EEC",
  similarity: 0.92,
};

describe("findSimilarPatterns", () => {
  beforeEach(() => {
    __mockExecute.mockReset();
  });

  it("returns patterns mapped to camelCase with similarity scores", async () => {
    __mockExecute.mockResolvedValue([sampleRow]);

    const results = await findSimilarPatterns(mockEmbedding());

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: sampleRow.id,
      clausePattern: sampleRow.clause_pattern,
      category: sampleRow.category,
      contractType: sampleRow.contract_type,
      riskLevel: sampleRow.risk_level,
      whyRisky: sampleRow.why_risky,
      saferAlternative: sampleRow.safer_alternative,
      jurisdictionNotes: sampleRow.jurisdiction_notes,
      similarity: 0.92,
    });
  });

  it("executes a query against the database", async () => {
    __mockExecute.mockResolvedValue([]);

    await findSimilarPatterns(mockEmbedding());

    expect(__mockExecute).toHaveBeenCalledOnce();
  });

  it("uses different SQL for contract type filter vs unfiltered", async () => {
    __mockExecute.mockResolvedValue([]);

    await findSimilarPatterns(mockEmbedding());
    const unfilteredSql = extractSqlStrings(__mockExecute.mock.calls[0]?.[0]);

    __mockExecute.mockReset();
    __mockExecute.mockResolvedValue([]);

    await findSimilarPatterns(mockEmbedding(), { contractType: "lease" });
    const filteredSql = extractSqlStrings(__mockExecute.mock.calls[0]?.[0]);

    // Filtered query includes WHERE clause with jsonb containment
    expect(filteredSql).toContain("WHERE");
    expect(filteredSql).toContain("@>");
    expect(unfilteredSql).not.toContain("WHERE");
  });

  it("returns empty array when no matches found", async () => {
    __mockExecute.mockResolvedValue([]);

    const results = await findSimilarPatterns(mockEmbedding());
    expect(results).toEqual([]);
  });

  it("returns multiple results ordered by similarity", async () => {
    __mockExecute.mockResolvedValue([
      { ...sampleRow, similarity: 0.95 },
      { ...sampleRow, id: "b1b2c3d4-0002-4a00-b000-000000000002", similarity: 0.85 },
      { ...sampleRow, id: "c1b2c3d4-0003-4a00-b000-000000000003", similarity: 0.72 },
    ]);

    const results = await findSimilarPatterns(mockEmbedding(), { topK: 3 });

    expect(results).toHaveLength(3);
    expect(results[0]?.similarity).toBe(0.95);
    expect(results[1]?.similarity).toBe(0.85);
    expect(results[2]?.similarity).toBe(0.72);
  });
});
