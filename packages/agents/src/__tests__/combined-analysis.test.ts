import type { PositionedClause, SSEEvent } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────

const mockStream = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { stream: mockStream },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6" },
}));

vi.mock("../format-patterns", () => ({
  formatPatternsForPrompt: () => "## Known Risk Patterns\n\n(mock patterns)",
}));

const { analyzeAllClauses, TOOL_DEFINITIONS } = await import("../combined-analysis");

// ── Test Helpers ──────────────────────────────────────────────────

/** Create a mock async iterable that yields the given events */
function createMockStream(events: Record<string, unknown>[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/** Build streaming events for a single tool call */
function toolCallEvents(index: number, name: string, input: Record<string, unknown>) {
  return [
    {
      type: "content_block_start",
      index,
      content_block: {
        type: "tool_use",
        id: `toolu_${index}`,
        name,
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(input),
      },
    },
    { type: "content_block_stop", index },
  ];
}

/** Build a complete stream with N clause tool calls + summary + end */
function buildHappyPathStream(
  clauseInputs: Record<string, unknown>[],
  summaryInput: Record<string, unknown>,
) {
  const events: Record<string, unknown>[] = [
    {
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", content: [] },
    },
  ];

  let blockIndex = 0;
  for (const input of clauseInputs) {
    events.push(...toolCallEvents(blockIndex, "report_clause", input));
    blockIndex++;
  }

  events.push(...toolCallEvents(blockIndex, "report_summary", summaryInput));
  events.push({
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 500 },
  });
  events.push({ type: "message_stop" });

  return events;
}

/** Collect all events from an async generator */
async function collectEvents(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ── Test Fixtures ─────────────────────────────────────────────────

const firstClause: PositionedClause = {
  text: "The landlord may enter at any time without notice.",
  position: 0,
  startIndex: 0,
  endIndex: 50,
};

const secondClause: PositionedClause = {
  text: "Rent shall be paid monthly on the first day.",
  position: 1,
  startIndex: 52,
  endIndex: 96,
};

const thirdClause: PositionedClause = {
  text: "The tenant is responsible for all repairs.",
  position: 2,
  startIndex: 98,
  endIndex: 139,
};

const testClauses: PositionedClause[] = [firstClause, secondClause, thirdClause];

const defaultParams = {
  clauses: testClauses,
  contractType: "lease",
  language: "en",
  responseLanguage: "en",
  ragPatterns: [],
};

// ── Tests ─────────────────────────────────────────────────────────

describe("analyzeAllClauses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields clause_analysis events for each clause and a summary", async () => {
    const streamEvents = buildHappyPathStream(
      [
        {
          position: 0,
          riskLevel: "red",
          explanation: "Entry without notice is illegal.",
          category: "entry_rights",
          saferAlternative: "Landlord must give 48h notice.",
        },
        {
          position: 1,
          riskLevel: "green",
          explanation: "Standard payment clause.",
          category: "payment",
          saferAlternative: "",
        },
        {
          position: 2,
          riskLevel: "yellow",
          explanation: "All repairs is overly broad.",
          category: "maintenance",
          saferAlternative: "Tenant handles minor repairs only.",
        },
      ],
      {
        overallRiskScore: 65,
        recommendation: "do_not_sign",
        topConcerns: ["Entry without notice", "Broad repair obligation"],
      },
    );

    mockStream.mockReturnValue(createMockStream(streamEvents));
    const events = await collectEvents(analyzeAllClauses(defaultParams));

    // 3 clause_analysis + 1 summary
    const clauseEvents = events.filter((e) => e.type === "clause_analysis");
    const summaryEvents = events.filter((e) => e.type === "summary");

    expect(clauseEvents).toHaveLength(3);
    expect(summaryEvents).toHaveLength(1);

    // Verify clause data
    const first = clauseEvents[0];
    expect(first?.type === "clause_analysis" && first.data.riskLevel).toBe("red");
    expect(first?.type === "clause_analysis" && first.data.clauseText).toBe(
      "The landlord may enter at any time without notice.",
    );
    expect(first?.type === "clause_analysis" && first.data.saferAlternative).toBe(
      "Landlord must give 48h notice.",
    );

    // Green clause has saferAlternative normalized to null
    const second = clauseEvents[1];
    expect(second?.type === "clause_analysis" && second.data.saferAlternative).toBeNull();

    // Summary data
    const summary = summaryEvents[0];
    expect(summary?.type === "summary" && summary.data.overallRiskScore).toBe(65);
    expect(summary?.type === "summary" && summary.data.clauseBreakdown).toEqual({
      red: 1,
      yellow: 1,
      green: 1,
    });
  });

  it("uses clauseText from input clauses, not from Claude output", async () => {
    const streamEvents = buildHappyPathStream(
      [
        {
          position: 0,
          riskLevel: "green",
          explanation: "OK",
          category: "general",
          saferAlternative: "",
        },
      ],
      {
        overallRiskScore: 10,
        recommendation: "sign",
        topConcerns: [],
      },
    );

    mockStream.mockReturnValue(createMockStream(streamEvents));
    const events = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const clause = events.find((e) => e.type === "clause_analysis");
    expect(clause?.type === "clause_analysis" && clause.data.clauseText).toBe(
      "The landlord may enter at any time without notice.",
    );
    expect(clause?.type === "clause_analysis" && clause.data.startIndex).toBe(0);
    expect(clause?.type === "clause_analysis" && clause.data.endIndex).toBe(50);
  });

  it("sets strict and eager_input_streaming on tool definitions", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(2);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.strict).toBe(true);
      expect(tool.eager_input_streaming).toBe(true);
    }
  });

  it("handles stop_reason: max_tokens — yields error for missing clauses", async () => {
    // Only 2 of 3 clauses reported, then max_tokens
    const events: Record<string, unknown>[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
        },
      },
      ...toolCallEvents(0, "report_clause", {
        position: 0,
        riskLevel: "red",
        explanation: "Bad",
        category: "entry_rights",
        saferAlternative: "Better",
      }),
      ...toolCallEvents(1, "report_clause", {
        position: 1,
        riskLevel: "green",
        explanation: "OK",
        category: "payment",
        saferAlternative: "",
      }),
      {
        type: "message_delta",
        delta: { stop_reason: "max_tokens", stop_sequence: null },
        usage: { output_tokens: 32768 },
      },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue(createMockStream(events));
    const result = await collectEvents(analyzeAllClauses(defaultParams));

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    const errorEvents = result.filter((e) => e.type === "error");

    expect(clauseEvents).toHaveLength(2);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.type === "error" && errorEvents[0].message).toContain(
      "1 clause(s) could not be analyzed",
    );
  });

  it("retries on API error, succeeds on second attempt", async () => {
    const successEvents = buildHappyPathStream(
      [
        {
          position: 0,
          riskLevel: "green",
          explanation: "OK",
          category: "general",
          saferAlternative: "",
        },
      ],
      {
        overallRiskScore: 10,
        recommendation: "sign",
        topConcerns: [],
      },
    );

    // First call throws, second succeeds
    mockStream
      .mockImplementationOnce(() => {
        throw new Error("API timeout");
      })
      .mockReturnValueOnce(createMockStream(successEvents));

    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(1);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("yields error after both attempts fail", async () => {
    mockStream
      .mockImplementationOnce(() => {
        throw new Error("API error 1");
      })
      .mockImplementationOnce(() => {
        throw new Error("API error 2");
      });

    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const errorEvents = result.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.type === "error" && errorEvents[0].message).toContain(
      "temporarily unavailable",
    );
  });

  it("skips invalid clause position from Claude", async () => {
    const events: Record<string, unknown>[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
        },
      },
      ...toolCallEvents(0, "report_clause", {
        position: 99,
        riskLevel: "red",
        explanation: "Bad",
        category: "test",
        saferAlternative: "Better",
      }),
      ...toolCallEvents(1, "report_clause", {
        position: 0,
        riskLevel: "green",
        explanation: "OK",
        category: "general",
        saferAlternative: "",
      }),
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 100 },
      },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue(createMockStream(events));
    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(1);
    expect(clauseEvents[0]?.type === "clause_analysis" && clauseEvents[0].data.position).toBe(0);
  });

  it("handles text-only response (no tool calls) without crashing", async () => {
    const events: Record<string, unknown>[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "I'll analyze..." },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 50 },
      },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue(createMockStream(events));
    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(0);
  });

  it("works without summary tool call (orchestrator handles fallback)", async () => {
    // Claude reports clauses but doesn't call report_summary
    const events: Record<string, unknown>[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
        },
      },
      ...toolCallEvents(0, "report_clause", {
        position: 0,
        riskLevel: "red",
        explanation: "Bad",
        category: "entry_rights",
        saferAlternative: "Better",
      }),
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 200 },
      },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue(createMockStream(events));
    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    const summaryEvents = result.filter((e) => e.type === "summary");
    expect(clauseEvents).toHaveLength(1);
    expect(summaryEvents).toHaveLength(0);
  });

  it("handles multi-chunk JSON deltas", async () => {
    const input = {
      position: 0,
      riskLevel: "red",
      explanation: "Very risky clause with detailed analysis.",
      category: "liability",
      saferAlternative: "A much safer version of this clause.",
    };
    const json = JSON.stringify(input);
    const mid = Math.floor(json.length / 2);

    const events: Record<string, unknown>[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_0",
          name: "report_clause",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: json.slice(0, mid),
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: json.slice(mid),
        },
      },
      { type: "content_block_stop", index: 0 },
      ...toolCallEvents(1, "report_summary", {
        overallRiskScore: 70,
        recommendation: "do_not_sign",
        topConcerns: ["Liability"],
      }),
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 300 },
      },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue(createMockStream(events));
    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: [firstClause] }),
    );

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(1);
    expect(clauseEvents[0]?.type === "clause_analysis" && clauseEvents[0].data.riskLevel).toBe(
      "red",
    );
  });

  it("handles resume with non-sequential positions", async () => {
    // Remaining clauses have positions 1 and 2 (0 already done)
    const remainingClauses = [secondClause, thirdClause];

    const streamEvents = buildHappyPathStream(
      [
        {
          position: 1,
          riskLevel: "green",
          explanation: "OK",
          category: "payment",
          saferAlternative: "",
        },
        {
          position: 2,
          riskLevel: "yellow",
          explanation: "Broad",
          category: "maintenance",
          saferAlternative: "Better",
        },
      ],
      {
        overallRiskScore: 35,
        recommendation: "caution",
        topConcerns: ["Broad repair obligation"],
      },
    );

    mockStream.mockReturnValue(createMockStream(streamEvents));
    const result = await collectEvents(
      analyzeAllClauses({ ...defaultParams, clauses: remainingClauses }),
    );

    const clauseEvents = result.filter((e) => e.type === "clause_analysis");
    expect(clauseEvents).toHaveLength(2);
    expect(clauseEvents[0]?.type === "clause_analysis" && clauseEvents[0].data.position).toBe(1);
    expect(clauseEvents[1]?.type === "clause_analysis" && clauseEvents[1].data.position).toBe(2);
  });
});
