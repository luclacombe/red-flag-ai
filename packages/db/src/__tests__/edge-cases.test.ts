import { VOYAGE_DIMENSIONS } from "@redflag/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embedTexts } from "../embeddings";

// ---------------------------------------------------------------------------
// Helpers (same pattern as embeddings.test.ts)
// ---------------------------------------------------------------------------

function mockEmbedding(seed = 0.1): number[] {
  return Array.from({ length: VOYAGE_DIMENSIONS }, (_, i) =>
    Number.parseFloat(((Math.sin(i + seed) + 1) / 2).toFixed(6)),
  );
}

function mockVoyageResponse(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      embedding: mockEmbedding(i),
    })),
    usage: { total_tokens: count * 10 },
  };
}

// ---------------------------------------------------------------------------
// Mock DB client for getPatternsByContractType tests
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Embedding batch boundary tests
// ---------------------------------------------------------------------------

describe("embedTexts batch boundaries", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.VOYAGE_API_KEY;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-voyage-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.VOYAGE_API_KEY = originalEnv;
    } else {
      delete process.env.VOYAGE_API_KEY;
    }
  });

  it("handles exactly 128 texts in a single API call", async () => {
    const texts = Array.from({ length: 128 }, (_, i) => `clause ${i}`);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockVoyageResponse(128)),
    });

    const result = await embedTexts(texts, "document");

    expect(result).toHaveLength(128);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    for (const embedding of result) {
      expect(embedding).toHaveLength(VOYAGE_DIMENSIONS);
    }
  });

  it("rejects 129 texts (exceeds single-batch limit)", async () => {
    const texts = Array.from({ length: 129 }, (_, i) => `clause ${i}`);

    await expect(embedTexts(texts, "document")).rejects.toThrow("max 128 texts");
  });

  it("rejects 256 texts", async () => {
    const texts = Array.from({ length: 256 }, (_, i) => `clause ${i}`);

    await expect(embedTexts(texts, "document")).rejects.toThrow("max 128 texts");
  });

  it("returns empty array for empty input without making an API call", async () => {
    globalThis.fetch = vi.fn();

    const result = await embedTexts([], "document");

    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// parseEmbedding edge cases (tested through getPatternsByContractType)
// ---------------------------------------------------------------------------

const baseRow = {
  id: "a1b2c3d4-1001-4a00-b000-000000000001",
  clause_pattern: "Landlord may enter at any time",
  category: "right_of_entry",
  contract_type: ["lease"],
  risk_level: "red",
  why_risky: "Violates tenant privacy rights",
  safer_alternative: "Landlord may enter with 48 hours written notice",
  jurisdiction_notes: "EU Directive 93/13/EEC",
};

describe("parseEmbedding edge cases (via getPatternsByContractType)", () => {
  beforeEach(() => {
    __mockExecute.mockReset();
  });

  it("parses embedding from JSON string format (pgvector raw SQL)", async () => {
    __mockExecute.mockResolvedValue([{ ...baseRow, embedding: "[0.1,0.2,0.3]" }]);

    const results = await getPatternsByContractType("lease");

    expect(results).toHaveLength(1);
    expect(results[0]!.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("passes through embedding that is already a number array", async () => {
    __mockExecute.mockResolvedValue([{ ...baseRow, embedding: [0.4, 0.5, 0.6] }]);

    const results = await getPatternsByContractType("lease");

    expect(results[0]!.embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("returns empty array for null embedding", async () => {
    __mockExecute.mockResolvedValue([{ ...baseRow, embedding: null }]);

    const results = await getPatternsByContractType("lease");

    expect(results[0]!.embedding).toEqual([]);
  });

  it("returns empty array for undefined embedding", async () => {
    __mockExecute.mockResolvedValue([{ ...baseRow, embedding: undefined }]);

    const results = await getPatternsByContractType("lease");

    expect(results[0]!.embedding).toEqual([]);
  });
});
