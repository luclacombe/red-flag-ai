import type { SSEEvent } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock DB
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
  analyses: { id: "id", status: "status", updatedAt: "updated_at", documentId: "document_id" },
  clauses: { analysisId: "analysis_id", position: "position" },
  documents: { id: "id" },
  eq: vi.fn((_col: unknown, _val: unknown) => "eq-condition"),
  sql: Object.assign((strings: TemplateStringsArray, ..._values: unknown[]) => strings.join(""), {
    raw: (str: string) => str,
  }),
}));

// Mock analyzeContract
const mockAnalyzeContract = vi.fn();
vi.mock("@redflag/agents", () => ({
  analyzeContract: (...args: unknown[]) => mockAnalyzeContract(...args),
}));

const { appRouter, createCallerFactory, createTRPCContext } = await import("../index");

async function createCaller() {
  const factory = createCallerFactory(appRouter);
  return factory(await createTRPCContext());
}

describe("analysis.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for non-existent analysis", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    });

    const caller = await createCaller();
    const result = await caller.analysis.get({
      analysisId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result).toBeNull();
  });

  it("returns analysis with clauses", async () => {
    const analysis = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "complete",
      overallRiskScore: 45,
    };
    const clauseRows = [{ id: "c1", clauseText: "Clause 1", position: 0, riskLevel: "green" }];

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(clauseRows),
          }),
        }),
      };
    });

    const caller = await createCaller();
    const result = await caller.analysis.get({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe("complete");
    expect(result?.clauses).toHaveLength(1);
  });
});

describe("analysis.stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields error for non-existent analysis", async () => {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "00000000-0000-0000-0000-000000000000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events[0]).toMatchObject({
      type: "error",
      message: "Analysis not found.",
    });
  });

  it("replays clauses and summary for completed analysis", async () => {
    const analysis = {
      id: "a1",
      status: "complete",
      documentId: "doc-1",
      overallRiskScore: 30,
      recommendation: "sign",
      topConcerns: [],
      updatedAt: new Date(),
    };
    const clauseRows = [
      {
        clauseText: "Clause 1",
        startIndex: 0,
        endIndex: 8,
        position: 0,
        riskLevel: "green",
        explanation: "OK",
        saferAlternative: null,
        category: "general",
        matchedPatterns: [],
      },
    ];

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(clauseRows),
          }),
        }),
      };
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events[0]?.type).toBe("clause_analysis");
    expect(events[1]?.type).toBe("summary");
    expect(events).toHaveLength(2);
  });

  it("yields error for failed analysis", async () => {
    const analysis = {
      id: "a1",
      status: "failed",
      errorMessage: "Parse agent failed",
      updatedAt: new Date(),
    };

    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([analysis]) }),
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events[0]).toMatchObject({
      type: "error",
      message: "Parse agent failed",
      recoverable: true,
    });
  });

  it("polls DB and replays results when processing analysis completes", async () => {
    vi.useFakeTimers();

    const analysis = {
      id: "a1",
      status: "processing",
      updatedAt: new Date(), // Just now — not stale
      parsedClauses: null,
    };
    const completedAnalysis = {
      id: "a1",
      status: "complete",
      updatedAt: new Date(),
      overallRiskScore: 30,
      recommendation: "sign",
      topConcerns: [],
      parsedClauses: null,
    };
    const dbClause = {
      clauseText: "Clause 1.",
      startIndex: 0,
      endIndex: 9,
      position: 0,
      riskLevel: "green",
      explanation: "Standard.",
      saferAlternative: null,
      category: "general",
      matchedPatterns: [],
    };

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Initial status check → processing
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      if (callCount === 2) {
        // Initial existing clauses check (empty)
        return { from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) };
      }
      if (callCount === 3) {
        // First poll → complete
        return { from: () => ({ where: () => Promise.resolve([completedAnalysis]) }) };
      }
      // Clause replay after completion
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([dbClause]),
          }),
        }),
      };
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];

    // Start consuming events (will block on 3s poll interval)
    const collectPromise = (async () => {
      const iterable = await caller.analysis.stream({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      });
      for await (const event of iterable) {
        events.push(event as SSEEvent);
      }
    })();

    // Advance past the 3s poll interval
    await vi.advanceTimersByTimeAsync(4_000);
    await collectPromise;

    expect(events.some((e) => e.type === "status")).toBe(true);
    expect(events.some((e) => e.type === "clause_analysis")).toBe(true);
    expect(events.some((e) => e.type === "summary")).toBe(true);

    vi.useRealTimers();
  });

  it("runs pipeline for pending analysis after claiming", async () => {
    const analysis = {
      id: "a1",
      status: "pending",
      documentId: "doc-1",
      updatedAt: new Date(),
    };
    const document = {
      id: "doc-1",
      extractedText: "Contract text here.",
      contractType: "nda",
      language: "en",
    };

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      return { from: () => ({ where: () => Promise.resolve([document]) }) };
    });

    // claimAnalysis returns claimed row
    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([analysis]),
        }),
      }),
    });

    // Mock pipeline events
    async function* fakeAnalyze(): AsyncGenerator<SSEEvent> {
      yield { type: "status", message: "Parsing..." };
      yield {
        type: "clause_analysis",
        data: {
          clauseText: "Clause 1",
          startIndex: 0,
          endIndex: 8,
          position: 0,
          riskLevel: "green" as const,
          explanation: "OK",
          saferAlternative: null,
          category: "general",
          matchedPatterns: [],
        },
      };
      yield {
        type: "summary",
        data: {
          overallRiskScore: 10,
          recommendation: "sign" as const,
          topConcerns: [],
          clauseBreakdown: { red: 0, yellow: 0, green: 1 },
          language: "en",
          contractType: "nda",
        },
      };
    }
    mockAnalyzeContract.mockReturnValue(fakeAnalyze());

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events.some((e) => e.type === "clause_analysis")).toBe(true);
    expect(events.some((e) => e.type === "summary")).toBe(true);
    expect(mockAnalyzeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        text: "Contract text here.",
        contractType: "nda",
        language: "en",
      }),
    );
  });

  it("yields status when claim fails (already claimed)", async () => {
    const analysis = {
      id: "a1",
      status: "pending",
      updatedAt: new Date(),
    };

    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([analysis]) }),
    });

    // claimAnalysis returns empty (already claimed by another consumer)
    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(
      events.some((e) => e.type === "status" && e.message === "Analysis already in progress."),
    ).toBe(true);
  });
});
