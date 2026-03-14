import type { SSEEvent } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock all dependencies
const mockParseClauses = vi.fn();
const mockAnalyzeClause = vi.fn();
const mockRewriteClause = vi.fn();
const mockSummarize = vi.fn();
const mockEmbedTexts = vi.fn();
const mockFindSimilarPatterns = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    }),
  }),
});

vi.mock("../parse", () => ({
  parseClauses: (...args: unknown[]) => mockParseClauses(...args),
}));

vi.mock("../risk", () => ({
  analyzeClause: (...args: unknown[]) => mockAnalyzeClause(...args),
}));

vi.mock("../rewrite", () => ({
  rewriteClause: (...args: unknown[]) => mockRewriteClause(...args),
}));

vi.mock("../summary", () => ({
  summarize: (...args: unknown[]) => mockSummarize(...args),
}));

vi.mock("@redflag/db", () => ({
  embedTexts: (...args: unknown[]) => mockEmbedTexts(...args),
  findSimilarPatterns: (...args: unknown[]) => mockFindSimilarPatterns(...args),
  getDb: () => ({
    insert: mockInsert,
    update: mockUpdate,
  }),
  analyses: { id: "id" },
  clauses: {},
  eq: vi.fn(),
}));

const { analyzeContract } = await import("../orchestrator");

async function collectEvents(params: {
  analysisId: string;
  text: string;
  contractType: string;
  language: string;
}): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of analyzeContract(params)) {
    events.push(event);
  }
  return events;
}

const baseParams = {
  analysisId: "test-analysis-id",
  text: "1. RENT. Tenant pays $1000. 2. DEPOSIT. $2000 required.",
  contractType: "residential_lease",
  language: "en",
};

describe("analyzeContract orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset insert mock chain
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("produces correct event sequence for happy path", async () => {
    mockParseClauses.mockResolvedValue([
      { text: "1. RENT. Tenant pays $1000.", position: 0 },
      { text: "2. DEPOSIT. $2000 required.", position: 1 },
    ]);
    mockEmbedTexts.mockResolvedValue([new Array(1024).fill(0.1), new Array(1024).fill(0.2)]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause
      .mockResolvedValueOnce({ riskLevel: "green", explanation: "Standard.", category: "rent" })
      .mockResolvedValueOnce({
        riskLevel: "red",
        explanation: "Excessive deposit.",
        category: "deposit",
      });
    mockRewriteClause.mockResolvedValue("Deposit of $1000.");
    mockSummarize.mockResolvedValue({
      overallRiskScore: 45,
      recommendation: "caution",
      topConcerns: ["High deposit"],
      language: "en",
      contractType: "residential_lease",
    });

    const events = await collectEvents(baseParams);

    // Verify event sequence: status, status, clause×2, status, summary
    expect(events[0]).toEqual({ type: "status", message: "Parsing contract clauses..." });
    expect(events[1]).toEqual({
      type: "status",
      message: "Found 2 clauses. Analyzing...",
    });
    expect(events[2]?.type).toBe("clause_analysis");
    expect(events[3]?.type).toBe("clause_analysis");
    expect(events[4]).toEqual({ type: "status", message: "Generating summary..." });
    expect(events[5]?.type).toBe("summary");
    expect(events).toHaveLength(6);
  });

  it("skips rewrite for green clauses", async () => {
    mockParseClauses.mockResolvedValue([{ text: "Standard clause.", position: 0 }]);
    mockEmbedTexts.mockResolvedValue([new Array(1024).fill(0.1)]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause.mockResolvedValue({
      riskLevel: "green",
      explanation: "Standard.",
      category: "general",
    });
    mockSummarize.mockResolvedValue({
      overallRiskScore: 10,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "nda",
    });

    await collectEvents(baseParams);

    expect(mockRewriteClause).not.toHaveBeenCalled();
  });

  it("calls rewrite for red and yellow clauses", async () => {
    mockParseClauses.mockResolvedValue([
      { text: "Clause 1.", position: 0 },
      { text: "Clause 2.", position: 1 },
    ]);
    mockEmbedTexts.mockResolvedValue([new Array(1024).fill(0.1), new Array(1024).fill(0.2)]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause
      .mockResolvedValueOnce({ riskLevel: "red", explanation: "Bad.", category: "liability" })
      .mockResolvedValueOnce({ riskLevel: "yellow", explanation: "Vague.", category: "payment" });
    mockRewriteClause.mockResolvedValue("Better clause.");
    mockSummarize.mockResolvedValue({
      overallRiskScore: 60,
      recommendation: "caution",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    });

    await collectEvents(baseParams);

    expect(mockRewriteClause).toHaveBeenCalledTimes(2);
  });

  it("yields error and stops when parse agent fails", async () => {
    mockParseClauses.mockRejectedValue(new Error("Parse failed"));

    const events = await collectEvents(baseParams);

    expect(events[0]?.type).toBe("status");
    expect(events[1]?.type).toBe("error");
    expect(events[1]).toMatchObject({
      type: "error",
      message: "Failed to parse contract clauses. Please try again.",
      recoverable: true,
    });
    expect(events).toHaveLength(2);
  });

  it("degrades gracefully when Voyage API is down", async () => {
    mockParseClauses.mockResolvedValue([{ text: "Clause text.", position: 0 }]);
    mockEmbedTexts.mockRejectedValue(new Error("Voyage API down"));
    mockAnalyzeClause.mockResolvedValue({
      riskLevel: "green",
      explanation: "Standard clause.",
      category: "general",
    });
    mockSummarize.mockResolvedValue({
      overallRiskScore: 10,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    });

    const events = await collectEvents(baseParams);

    // Should still produce clause analysis and summary
    const clauseEvent = events.find((e) => e.type === "clause_analysis");
    expect(clauseEvent).toBeDefined();
    if (clauseEvent?.type === "clause_analysis") {
      expect(clauseEvent.data.explanation).toContain("without knowledge base reference");
    }
    expect(events.some((e) => e.type === "summary")).toBe(true);
  });

  it("skips a clause when risk analysis fails", async () => {
    mockParseClauses.mockResolvedValue([
      { text: "Clause 1.", position: 0 },
      { text: "Clause 2.", position: 1 },
    ]);
    mockEmbedTexts.mockResolvedValue([new Array(1024).fill(0.1), new Array(1024).fill(0.2)]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause
      .mockRejectedValueOnce(new Error("Risk failed"))
      .mockResolvedValueOnce({ riskLevel: "green", explanation: "OK.", category: "general" });
    mockSummarize.mockResolvedValue({
      overallRiskScore: 10,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    });

    const events = await collectEvents(baseParams);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      message: "Failed to analyze clause 1. Skipping.",
      recoverable: true,
    });
    // Only 1 clause_analysis (clause 2 succeeded)
    const clauseEvents = events.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(1);
    // Summary still generated
    expect(events.some((e) => e.type === "summary")).toBe(true);
  });

  it("continues with null saferAlternative when rewrite fails", async () => {
    mockParseClauses.mockResolvedValue([{ text: "Bad clause.", position: 0 }]);
    mockEmbedTexts.mockResolvedValue([new Array(1024).fill(0.1)]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause.mockResolvedValue({
      riskLevel: "red",
      explanation: "Risky.",
      category: "liability",
    });
    mockRewriteClause.mockRejectedValue(new Error("Rewrite failed"));
    mockSummarize.mockResolvedValue({
      overallRiskScore: 70,
      recommendation: "do_not_sign",
      topConcerns: ["Liability"],
      language: "en",
      contractType: "lease",
    });

    const events = await collectEvents(baseParams);

    const clauseEvent = events.find((e) => e.type === "clause_analysis");
    if (clauseEvent?.type === "clause_analysis") {
      expect(clauseEvent.data.saferAlternative).toBeNull();
    }
  });

  it("yields error when no clauses found", async () => {
    mockParseClauses.mockResolvedValue([]);

    const events = await collectEvents(baseParams);

    expect(events[1]).toMatchObject({
      type: "error",
      message: "No clauses could be identified in this document.",
      recoverable: false,
    });
  });

  it("computes clauseBreakdown deterministically in summary", async () => {
    mockParseClauses.mockResolvedValue([
      { text: "C1.", position: 0 },
      { text: "C2.", position: 1 },
      { text: "C3.", position: 2 },
    ]);
    mockEmbedTexts.mockResolvedValue([
      new Array(1024).fill(0.1),
      new Array(1024).fill(0.2),
      new Array(1024).fill(0.3),
    ]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause
      .mockResolvedValueOnce({ riskLevel: "red", explanation: "R.", category: "a" })
      .mockResolvedValueOnce({ riskLevel: "yellow", explanation: "Y.", category: "b" })
      .mockResolvedValueOnce({ riskLevel: "green", explanation: "G.", category: "c" });
    mockRewriteClause.mockResolvedValue("Better.");
    mockSummarize.mockResolvedValue({
      overallRiskScore: 50,
      recommendation: "caution",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    });

    const events = await collectEvents(baseParams);
    const summaryEvent = events.find((e) => e.type === "summary");

    if (summaryEvent?.type === "summary") {
      expect(summaryEvent.data.clauseBreakdown).toEqual({
        red: 1,
        yellow: 1,
        green: 1,
      });
    }
  });

  it("defaults language to en when not provided", async () => {
    mockParseClauses.mockResolvedValue([{ text: "Clause.", position: 0 }]);
    mockEmbedTexts.mockResolvedValue([new Array(1024).fill(0.1)]);
    mockFindSimilarPatterns.mockResolvedValue([]);
    mockAnalyzeClause.mockResolvedValue({
      riskLevel: "green",
      explanation: "OK.",
      category: "general",
    });
    mockSummarize.mockResolvedValue({
      overallRiskScore: 10,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "lease",
    });

    await collectEvents({ ...baseParams, language: "" });

    expect(mockParseClauses).toHaveBeenCalledWith(expect.any(String), expect.any(String), "en");
  });
});
