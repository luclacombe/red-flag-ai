import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6" },
  stripCodeFences: (t: string) => t,
}));

const { summarize } = await import("../summary");

function makeTextResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const sampleAnalyses = [
  {
    riskLevel: "red",
    explanation: "Entry without notice.",
    category: "entry_rights",
    clauseText: "Landlord may enter at any time.",
  },
  {
    riskLevel: "green",
    explanation: "Standard rent clause.",
    category: "rent",
    clauseText: "Tenant pays $1000 monthly.",
  },
];

describe("summarize", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns summary with risk score and recommendation", async () => {
    const response = {
      overallRiskScore: 65,
      recommendation: "do_not_sign",
      topConcerns: ["Entry without notice is illegal in most jurisdictions"],
      language: "en",
      contractType: "residential_lease",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await summarize(sampleAnalyses, "residential_lease", "en", "en");

    expect(result.overallRiskScore).toBe(65);
    expect(result.recommendation).toBe("do_not_sign");
    expect(result.topConcerns).toHaveLength(1);
    expect(result.language).toBe("en");
    expect(result.contractType).toBe("residential_lease");
    // clauseBreakdown is NOT returned by summarize — orchestrator computes it
    expect(result).not.toHaveProperty("clauseBreakdown");
  });

  it("retries on malformed response, then throws", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse("bad"));
    mockCreate.mockResolvedValueOnce(makeTextResponse("{}"));

    await expect(summarize(sampleAnalyses, "lease", "en", "en")).rejects.toThrow(
      /Summary agent failed after 2 attempts/,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries on API error, succeeds on second attempt", async () => {
    const response = {
      overallRiskScore: 20,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "nda",
    };
    mockCreate.mockRejectedValueOnce(new Error("timeout"));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await summarize(sampleAnalyses, "nda", "en", "en");
    expect(result.overallRiskScore).toBe(20);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid recommendation value", async () => {
    const response = {
      overallRiskScore: 50,
      recommendation: "maybe",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await expect(summarize(sampleAnalyses, "lease", "en", "en")).rejects.toThrow(
      /Summary agent failed after 2 attempts/,
    );
  });

  it("rejects risk score out of range", async () => {
    const response = {
      overallRiskScore: 150,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await expect(summarize(sampleAnalyses, "lease", "en", "en")).rejects.toThrow(
      /Summary agent failed after 2 attempts/,
    );
  });

  it("includes clause analysis data in prompt", async () => {
    const response = {
      overallRiskScore: 30,
      recommendation: "caution",
      topConcerns: ["entry rights"],
      language: "en",
      contractType: "lease",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await summarize(sampleAnalyses, "residential_lease", "en", "en");

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(callArgs.messages[0]?.content).toContain("RED");
    expect(callArgs.messages[0]?.content).toContain("entry_rights");
    expect(callArgs.messages[0]?.content).toContain("Red flags: 1");
  });
});
