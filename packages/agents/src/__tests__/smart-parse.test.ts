import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────

const mockParseClausesHeuristic = vi.fn();
const mockDetectClauseBoundaries = vi.fn();

vi.mock("../heuristic-parse", () => ({
  parseClausesHeuristic: (...args: unknown[]) => mockParseClausesHeuristic(...args),
}));

vi.mock("../boundary-detect", () => ({
  detectClauseBoundaries: (...args: unknown[]) => mockDetectClauseBoundaries(...args),
}));

const { isSuspiciousResult, parseClausesSmart } = await import("../smart-parse");

// ── Tests ──────────────────────────────────────────────────────────

describe("isSuspiciousResult", () => {
  it("returns false for 0 clauses (handled separately)", () => {
    expect(isSuspiciousResult([], 1000)).toBe(false);
  });

  it("returns true for 1 clause with document > 500 chars", () => {
    expect(isSuspiciousResult([{ text: "x".repeat(600), position: 0 }], 600)).toBe(true);
  });

  it("returns false for 1 clause with document <= 500 chars (short doc)", () => {
    expect(isSuspiciousResult([{ text: "x".repeat(400), position: 0 }], 400)).toBe(false);
  });

  it("returns false for any result when document <= 500 chars", () => {
    expect(
      isSuspiciousResult(
        [
          { text: "x".repeat(450), position: 0 },
          { text: "x".repeat(10), position: 1 },
        ],
        500,
      ),
    ).toBe(false);
  });

  it("returns true for 2 clauses with document > 2000 chars", () => {
    expect(
      isSuspiciousResult(
        [
          { text: "x".repeat(1200), position: 0 },
          { text: "x".repeat(900), position: 1 },
        ],
        2100,
      ),
    ).toBe(true);
  });

  it("returns false for 2 clauses with document <= 2000 chars", () => {
    expect(
      isSuspiciousResult(
        [
          { text: "x".repeat(800), position: 0 },
          { text: "x".repeat(800), position: 1 },
        ],
        1600,
      ),
    ).toBe(false);
  });

  it("returns true when largest clause > 80% of document (3+ clauses)", () => {
    expect(
      isSuspiciousResult(
        [
          { text: "x".repeat(900), position: 0 },
          { text: "x".repeat(50), position: 1 },
          { text: "x".repeat(50), position: 2 },
        ],
        1000,
      ),
    ).toBe(true);
  });

  it("returns false for 3+ clauses with reasonable distribution", () => {
    expect(
      isSuspiciousResult(
        [
          { text: "x".repeat(300), position: 0 },
          { text: "x".repeat(300), position: 1 },
          { text: "x".repeat(300), position: 2 },
        ],
        900,
      ),
    ).toBe(false);
  });
});

describe("parseClausesSmart", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses heuristic path when result has clear numbered sections", async () => {
    const goodResult = [
      { text: "Clause 1 text...", position: 0 },
      { text: "Clause 2 text...", position: 1 },
      { text: "Clause 3 text...", position: 2 },
    ];
    mockParseClausesHeuristic.mockReturnValue(goodResult);

    const result = await parseClausesSmart("short text", "lease", "en");

    expect(result).toEqual(goodResult);
    expect(mockDetectClauseBoundaries).not.toHaveBeenCalled();
  });

  it("triggers LLM fallback when heuristic produces 1 clause for large document", async () => {
    const largeText = "x".repeat(1000);
    mockParseClausesHeuristic.mockReturnValue([{ text: largeText, position: 0 }]);

    const llmResult = Array.from({ length: 10 }, (_, i) => ({
      text: `Clause ${i}`,
      position: i,
    }));
    mockDetectClauseBoundaries.mockResolvedValue(llmResult);

    const result = await parseClausesSmart(largeText, "lease", "nl");

    expect(result).toEqual(llmResult);
    expect(mockDetectClauseBoundaries).toHaveBeenCalledWith(largeText, "lease", "nl");
  });

  it("triggers LLM fallback when heuristic produces 2 clauses for large document", async () => {
    const largeText = "x".repeat(3000);
    mockParseClausesHeuristic.mockReturnValue([
      { text: "x".repeat(1500), position: 0 },
      { text: "x".repeat(1500), position: 1 },
    ]);

    const llmResult = Array.from({ length: 8 }, (_, i) => ({
      text: `Clause ${i}`,
      position: i,
    }));
    mockDetectClauseBoundaries.mockResolvedValue(llmResult);

    const result = await parseClausesSmart(largeText, "lease", "nl");

    expect(result).toEqual(llmResult);
    expect(mockDetectClauseBoundaries).toHaveBeenCalled();
  });

  it("keeps heuristic result for short document (< 500 chars) with 1 clause", async () => {
    const shortText = "Short agreement.";
    const shortResult = [{ text: shortText, position: 0 }];
    mockParseClausesHeuristic.mockReturnValue(shortResult);

    const result = await parseClausesSmart(shortText, "lease", "en");

    expect(result).toEqual(shortResult);
    expect(mockDetectClauseBoundaries).not.toHaveBeenCalled();
  });

  it("returns heuristic result when LLM fallback fails (graceful degradation)", async () => {
    const largeText = "x".repeat(1000);
    const heuristicResult = [{ text: largeText, position: 0 }];
    mockParseClausesHeuristic.mockReturnValue(heuristicResult);
    mockDetectClauseBoundaries.mockRejectedValue(new Error("Haiku API down"));

    const result = await parseClausesSmart(largeText, "lease", "nl");

    expect(result).toEqual(heuristicResult);
    expect(mockDetectClauseBoundaries).toHaveBeenCalled();
  });

  it("passes correct arguments to both parsers", async () => {
    const text = "x".repeat(1000);
    mockParseClausesHeuristic.mockReturnValue([{ text, position: 0 }]);
    mockDetectClauseBoundaries.mockResolvedValue([
      { text: "Clause 1", position: 0 },
      { text: "Clause 2", position: 1 },
    ]);

    await parseClausesSmart(text, "residential_lease", "nl");

    expect(mockParseClausesHeuristic).toHaveBeenCalledWith(text, "residential_lease", "nl");
    expect(mockDetectClauseBoundaries).toHaveBeenCalledWith(text, "residential_lease", "nl");
  });
});
