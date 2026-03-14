import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-5-20250514" },
}));

const { analyzeClause } = await import("../risk");

function makeTextResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const sampleClause = {
  text: "The landlord may enter at any time without notice.",
  position: 0,
  startIndex: 0,
  endIndex: 50,
};

const samplePatterns = [
  {
    id: "pat-1",
    clausePattern: "Landlord may enter without notice",
    category: "entry_rights",
    contractType: ["lease"],
    riskLevel: "red" as const,
    whyRisky: "Most jurisdictions require notice",
    saferAlternative: "Landlord must give 48h notice",
    jurisdictionNotes: "EU directive",
    similarity: 0.85,
  },
];

describe("analyzeClause", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns risk analysis for a red clause", async () => {
    const response = {
      riskLevel: "red",
      explanation: "This clause allows entry without notice.",
      category: "entry_rights",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await analyzeClause(sampleClause, samplePatterns, "en");

    expect(result.riskLevel).toBe("red");
    expect(result.explanation).toContain("entry without notice");
    expect(result.category).toBe("entry_rights");
  });

  it("returns green for a safe clause", async () => {
    const response = {
      riskLevel: "green",
      explanation: "Standard clause.",
      category: "general",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await analyzeClause(sampleClause, [], "en");
    expect(result.riskLevel).toBe("green");
  });

  it("retries on malformed response, then throws", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse("bad json"));
    mockCreate.mockResolvedValueOnce(makeTextResponse("{}"));

    await expect(analyzeClause(sampleClause, [], "en")).rejects.toThrow(
      /Risk agent failed after 2 attempts/,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries on API error, succeeds on second attempt", async () => {
    const response = {
      riskLevel: "yellow",
      explanation: "Vague wording.",
      category: "liability",
    };
    mockCreate.mockRejectedValueOnce(new Error("timeout"));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await analyzeClause(sampleClause, [], "en");
    expect(result.riskLevel).toBe("yellow");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("includes patterns in the prompt when provided", async () => {
    const response = {
      riskLevel: "red",
      explanation: "Bad clause.",
      category: "entry_rights",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await analyzeClause(sampleClause, samplePatterns, "en");

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(callArgs.messages[0]?.content).toContain("Landlord may enter without notice");
    expect(callArgs.messages[0]?.content).toContain("Most jurisdictions require notice");
  });

  it("rejects invalid riskLevel from Claude", async () => {
    const response = {
      riskLevel: "orange",
      explanation: "Invalid.",
      category: "test",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await expect(analyzeClause(sampleClause, [], "en")).rejects.toThrow(
      /Risk agent failed after 2 attempts/,
    );
  });
});
