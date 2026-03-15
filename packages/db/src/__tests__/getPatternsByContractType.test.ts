import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the client module before importing
vi.mock("../client", () => {
  const mockExecute = vi.fn();
  return {
    getDb: vi.fn(() => ({
      execute: mockExecute,
    })),
    __mockExecute: mockExecute,
  };
});

const { getPatternsByContractType } = await import("../queries/getPatternsByContractType");
const { __mockExecute } = (await import("../client")) as unknown as {
  __mockExecute: ReturnType<typeof vi.fn>;
};

/** Extract string literal chunks from Drizzle SQL template */
function extractSqlStrings(sqlObj: unknown): string {
  if (sqlObj == null) return "";
  if (typeof sqlObj === "string") return sqlObj;
  if (Array.isArray(sqlObj)) return sqlObj.map(extractSqlStrings).join("");
  if (typeof sqlObj === "object") {
    const obj = sqlObj as Record<string, unknown>;
    if (obj.queryChunks) return extractSqlStrings(obj.queryChunks);
    if (obj.value && Array.isArray(obj.value) && obj.value.every((v) => typeof v === "string"))
      return (obj.value as string[]).join("");
  }
  return "";
}

const sampleRow = {
  id: "a1b2c3d4-1001-4a00-b000-000000000001",
  clause_pattern: "Landlord may enter at any time without notice",
  category: "right_of_entry",
  contract_type: ["lease", "residential_lease"],
  risk_level: "red",
  why_risky: "Violates tenant privacy rights",
  safer_alternative: "Landlord may enter with 48 hours written notice",
  jurisdiction_notes: "EU Directive 93/13/EEC",
  embedding: "[0.1,0.2,0.3]",
};

describe("getPatternsByContractType", () => {
  beforeEach(() => {
    __mockExecute.mockReset();
  });

  it("returns patterns mapped to camelCase with embeddings", async () => {
    __mockExecute.mockResolvedValue([sampleRow]);

    const results = await getPatternsByContractType("lease");

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
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it("filters by contract type using jsonb containment", async () => {
    __mockExecute.mockResolvedValue([]);

    await getPatternsByContractType("residential_lease");

    expect(__mockExecute).toHaveBeenCalledOnce();
    const sqlStr = extractSqlStrings(__mockExecute.mock.calls[0]?.[0]);
    expect(sqlStr).toContain("@>");
    expect(sqlStr).toContain("::jsonb");
  });

  it("includes embedding column in the SELECT", async () => {
    __mockExecute.mockResolvedValue([]);

    await getPatternsByContractType("nda");

    const sqlStr = extractSqlStrings(__mockExecute.mock.calls[0]?.[0]);
    expect(sqlStr).toContain("embedding");
  });

  it("orders by category and risk level", async () => {
    __mockExecute.mockResolvedValue([]);

    await getPatternsByContractType("lease");

    const sqlStr = extractSqlStrings(__mockExecute.mock.calls[0]?.[0]);
    expect(sqlStr).toContain("ORDER BY");
    expect(sqlStr).toContain("category");
    expect(sqlStr).toContain("risk_level");
  });

  it("returns empty array when no patterns match", async () => {
    __mockExecute.mockResolvedValue([]);

    const results = await getPatternsByContractType("unknown_type");

    expect(results).toEqual([]);
  });

  it("handles embedding as number array (Drizzle typed query)", async () => {
    __mockExecute.mockResolvedValue([{ ...sampleRow, embedding: [0.4, 0.5, 0.6] }]);

    const results = await getPatternsByContractType("lease");

    expect(results[0]!.embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("returns multiple results", async () => {
    __mockExecute.mockResolvedValue([
      sampleRow,
      {
        ...sampleRow,
        id: "b1b2c3d4-0002-4a00-b000-000000000002",
        category: "deposit",
        risk_level: "yellow",
      },
    ]);

    const results = await getPatternsByContractType("lease");

    expect(results).toHaveLength(2);
    expect(results[0]!.category).toBe("right_of_entry");
    expect(results[1]!.category).toBe("deposit");
  });
});
