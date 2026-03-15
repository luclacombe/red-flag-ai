import type { ClauseAnalysis, SSEEvent, Summary } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────

const mockParseClausesSmart = vi.fn();
const mockAnalyzeAllClauses = vi.fn();
const mockComputeMatchedPatterns = vi.fn();
const mockSummarize = vi.fn();
const mockGetPatternsByContractType = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});
const mockSelect = vi.fn();

vi.mock("../smart-parse", () => ({
  parseClausesSmart: (...args: unknown[]) => mockParseClausesSmart(...args),
}));

vi.mock("../combined-analysis", () => ({
  analyzeAllClauses: (...args: unknown[]) => mockAnalyzeAllClauses(...args),
}));

vi.mock("../compute-matched-patterns", () => ({
  computeMatchedPatterns: (...args: unknown[]) => mockComputeMatchedPatterns(...args),
}));

vi.mock("../summary", () => ({
  summarize: (...args: unknown[]) => mockSummarize(...args),
}));

vi.mock("@redflag/db", () => ({
  getPatternsByContractType: (...args: unknown[]) => mockGetPatternsByContractType(...args),
  getDb: () => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  }),
  analyses: { id: "id", parsedClauses: "parsed_clauses" },
  clauses: { analysisId: "analysis_id", position: "position" },
  eq: vi.fn(),
  sql: vi.fn(),
}));

const { analyzeContract } = await import("../orchestrator");

// ── Test Helpers ──────────────────────────────────────────────────

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

/** Create a mock async generator that yields the given events */
function mockAsyncGen(events: SSEEvent[]) {
  return async function* () {
    for (const event of events) {
      yield event;
    }
  };
}

/** Standard clause analysis event */
function clauseEvent(
  position: number,
  riskLevel: "red" | "yellow" | "green",
  opts?: Partial<ClauseAnalysis>,
): SSEEvent {
  return {
    type: "clause_analysis",
    data: {
      clauseText: `Clause ${position}.`,
      startIndex: position * 20,
      endIndex: position * 20 + 15,
      position,
      riskLevel,
      explanation: `Explanation for clause ${position}`,
      saferAlternative: riskLevel === "green" ? null : "Better version.",
      category: "general",
      matchedPatterns: [],
      ...opts,
    },
  };
}

/** Standard summary event */
function summaryEvent(score: number, recommendation: Summary["recommendation"]): SSEEvent {
  return {
    type: "summary",
    data: {
      overallRiskScore: score,
      recommendation,
      topConcerns: score > 30 ? ["Some concern"] : [],
      clauseBreakdown: { red: 0, yellow: 0, green: 0 },
      language: "en",
      contractType: "lease",
    },
  };
}

const baseParams = {
  analysisId: "test-analysis-id",
  text: "1. RENT. Tenant pays $1000.\n\n2. DEPOSIT. $2000 required.\n\n3. TERMINATION. 30 days notice.",
  contractType: "residential_lease",
  language: "en",
};

/** Configure mocks to simulate a fresh analysis (no cached parse, no existing clauses) */
function setupFreshAnalysis() {
  let selectCallCount = 0;
  mockSelect.mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return Promise.resolve([{ id: "test-analysis-id", parsedClauses: null }]);
        }
        return { orderBy: vi.fn().mockResolvedValue([]) };
      }),
    })),
  }));
}

// ── Tests ─────────────────────────────────────────────────────────

describe("analyzeContract orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockGetPatternsByContractType.mockResolvedValue([]);
    mockComputeMatchedPatterns.mockResolvedValue(new Map());
    setupFreshAnalysis();
  });

  it("produces correct event sequence: clause_positions → status → clause_analysis ×N → summary", async () => {
    mockParseClausesSmart.mockResolvedValue([
      { text: "1. RENT. Tenant pays $1000.", position: 0 },
      { text: "2. DEPOSIT. $2000 required.", position: 1 },
    ]);

    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), clauseEvent(1, "red"), summaryEvent(55, "caution")])(),
    );

    const events = await collectEvents(baseParams);

    // First event: clause_positions
    expect(events[0]?.type).toBe("clause_positions");
    if (events[0]?.type === "clause_positions") {
      expect(events[0].data.totalClauses).toBe(2);
    }

    // Second: status with clause count
    const foundStatus = events.find(
      (e) => e.type === "status" && "message" in e && e.message.includes("Found 2 clauses"),
    );
    expect(foundStatus).toBeDefined();

    // Clause events
    const clauseEvents = events.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(2);

    // Summary at end
    expect(events[events.length - 1]?.type).toBe("summary");
  });

  it("calls parseClausesSmart with correct arguments", async () => {
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    await collectEvents(baseParams);

    expect(mockParseClausesSmart).toHaveBeenCalledWith(baseParams.text, "residential_lease", "en");
  });

  it("fetches RAG patterns and passes them to combined analysis", async () => {
    const mockPatterns = [{ id: "p1", category: "rent", riskLevel: "red" }];
    mockGetPatternsByContractType.mockResolvedValue(mockPatterns);
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    await collectEvents(baseParams);

    expect(mockGetPatternsByContractType).toHaveBeenCalledWith("residential_lease");
    expect(mockAnalyzeAllClauses).toHaveBeenCalledWith(
      expect.objectContaining({
        ragPatterns: mockPatterns,
        contractType: "residential_lease",
        language: "en",
      }),
    );
  });

  it("runs computeMatchedPatterns in parallel and updates DB after stream", async () => {
    const matchedMap = new Map([[0, ["pat-1", "pat-2"]]]);
    mockComputeMatchedPatterns.mockResolvedValue(matchedMap);
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    await collectEvents(baseParams);

    // computeMatchedPatterns was called
    expect(mockComputeMatchedPatterns).toHaveBeenCalled();
    // DB update was called to set matchedPatterns
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("degrades gracefully when embedding fails", async () => {
    mockComputeMatchedPatterns.mockRejectedValue(new Error("Voyage API down"));
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    const events = await collectEvents(baseParams);

    // Should still produce clause_analysis and summary (no crash)
    expect(events.some((e) => e.type === "clause_analysis")).toBe(true);
    expect(events.some((e) => e.type === "summary")).toBe(true);
  });

  it("uses fallback summarize() when combined call does not yield summary", async () => {
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    // Combined analysis yields clause but NO summary
    mockAnalyzeAllClauses.mockReturnValue(mockAsyncGen([clauseEvent(0, "red")])());
    mockSummarize.mockResolvedValue({
      overallRiskScore: 70,
      recommendation: "do_not_sign",
      topConcerns: ["Bad clause"],
      language: "en",
      contractType: "residential_lease",
    });

    const events = await collectEvents(baseParams);

    expect(mockSummarize).toHaveBeenCalled();
    // Summary should still appear
    expect(events.some((e) => e.type === "summary")).toBe(true);
    // "Generating summary..." status should appear
    const genSummaryStatus = events.find(
      (e) => e.type === "status" && "message" in e && e.message.includes("Generating summary"),
    );
    expect(genSummaryStatus).toBeDefined();
  });

  it("does NOT call fallback summarize() when combined call yields summary", async () => {
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    await collectEvents(baseParams);

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("yields error when no clauses found", async () => {
    mockParseClausesSmart.mockResolvedValue([]);

    const events = await collectEvents(baseParams);

    expect(events.some((e) => e.type === "error")).toBe(true);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      message: "No clauses could be identified in this document.",
      recoverable: false,
    });
  });

  it("resumes from cached parse results and replays existing clauses", async () => {
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([
              {
                id: "test-analysis-id",
                parsedClauses: [
                  { text: "Clause 1.", position: 0, startIndex: 0, endIndex: 9 },
                  { text: "Clause 2.", position: 1, startIndex: 10, endIndex: 19 },
                ],
              },
            ]);
          }
          return {
            orderBy: vi.fn().mockResolvedValue([
              {
                clauseText: "Clause 1.",
                startIndex: 0,
                endIndex: 9,
                position: 0,
                riskLevel: "green",
                explanation: "OK.",
                saferAlternative: null,
                category: "general",
                matchedPatterns: [],
              },
            ]),
          };
        }),
      })),
    }));

    // Combined analysis for remaining clause (position 1)
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(1, "yellow"), summaryEvent(35, "caution")])(),
    );

    const events = await collectEvents(baseParams);

    // Parse should NOT have been called (cached)
    expect(mockParseClausesSmart).not.toHaveBeenCalled();
    // Should have clause_positions event
    expect(events[0]?.type).toBe("clause_positions");
    // Should have clause_analysis for both (replayed + new)
    const clauseEvents = events.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(2);
    // Combined analysis only called for remaining clause
    expect(mockAnalyzeAllClauses).toHaveBeenCalledWith(
      expect.objectContaining({
        clauses: [expect.objectContaining({ position: 1 })],
      }),
    );
  });

  it("emits clause_positions on resume path", async () => {
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([
              {
                id: "test-analysis-id",
                parsedClauses: [{ text: "Clause 1.", position: 0, startIndex: 0, endIndex: 9 }],
              },
            ]);
          }
          return { orderBy: vi.fn().mockResolvedValue([]) };
        }),
      })),
    }));

    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    const events = await collectEvents(baseParams);

    const posEvent = events.find((e) => e.type === "clause_positions");
    expect(posEvent).toBeDefined();
    if (posEvent?.type === "clause_positions") {
      expect(posEvent.data.totalClauses).toBe(1);
    }
  });

  it("calls heartbeat after each event", async () => {
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    await collectEvents(baseParams);

    // heartbeat = db.update(analyses).set({updatedAt}).where(...)
    // Called at least once per yielded event from combined analysis
    const updateCalls = mockUpdate.mock.calls.length;
    expect(updateCalls).toBeGreaterThanOrEqual(2);
  });

  it("defaults language to en when empty", async () => {
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "green"), summaryEvent(10, "sign")])(),
    );

    await collectEvents({ ...baseParams, language: "" });

    expect(mockParseClausesSmart).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "en",
    );
  });

  it("skips to summary when all clauses already analyzed", async () => {
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([
              {
                id: "test-analysis-id",
                parsedClauses: [{ text: "Clause 1.", position: 0, startIndex: 0, endIndex: 9 }],
              },
            ]);
          }
          return {
            orderBy: vi.fn().mockResolvedValue([
              {
                clauseText: "Clause 1.",
                startIndex: 0,
                endIndex: 9,
                position: 0,
                riskLevel: "green",
                explanation: "OK.",
                saferAlternative: null,
                category: "general",
                matchedPatterns: [],
              },
            ]),
          };
        }),
      })),
    }));

    mockSummarize.mockResolvedValue({
      overallRiskScore: 10,
      recommendation: "sign",
      topConcerns: [],
      language: "en",
      contractType: "residential_lease",
    });

    const events = await collectEvents(baseParams);

    // Combined analysis should NOT be called (all clauses done)
    expect(mockAnalyzeAllClauses).not.toHaveBeenCalled();
    // Fallback summary should be called
    expect(mockSummarize).toHaveBeenCalled();
    expect(events.some((e) => e.type === "summary")).toBe(true);
  });

  it("persists clause data to DB during streaming", async () => {
    mockParseClausesSmart.mockResolvedValue([{ text: "Clause 1.", position: 0 }]);
    mockAnalyzeAllClauses.mockReturnValue(
      mockAsyncGen([clauseEvent(0, "red"), summaryEvent(70, "do_not_sign")])(),
    );

    await collectEvents(baseParams);

    // db.insert(clauses).values() should have been called
    const insertValues = mockInsert.mock.results[0]?.value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: "test-analysis-id",
        position: 0,
        riskLevel: "red",
      }),
    );
  });
});
