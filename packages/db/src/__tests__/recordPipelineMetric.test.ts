import { describe, expect, it, vi } from "vitest";

const mockInsert = vi.fn();
const mockValues = vi.fn();

vi.mock("../client", () => ({
  getDb: () => ({
    insert: (table: unknown) => {
      mockInsert(table);
      return {
        values: (data: unknown) => {
          mockValues(data);
          return Promise.resolve();
        },
      };
    },
  }),
}));

vi.mock("../schema", () => ({
  pipelineMetrics: { _: "pipeline_metrics" },
}));

const { recordPipelineMetric } = await import("../queries/recordPipelineMetric");

describe("recordPipelineMetric", () => {
  it("inserts a metric with all fields", async () => {
    await recordPipelineMetric({
      analysisId: "analysis-123",
      step: "gate",
      durationMs: 500,
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "haiku",
      success: true,
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith({
      analysisId: "analysis-123",
      step: "gate",
      durationMs: 500,
      inputTokens: 100,
      outputTokens: 50,
      model: "haiku",
      success: true,
      errorMessage: null,
    });
  });

  it("inserts a metric with missing optional fields as null", async () => {
    await recordPipelineMetric({
      step: "parse",
      durationMs: 10,
      success: true,
    });

    expect(mockValues).toHaveBeenCalledWith({
      analysisId: null,
      step: "parse",
      durationMs: 10,
      inputTokens: null,
      outputTokens: null,
      model: null,
      success: true,
      errorMessage: null,
    });
  });

  it("inserts a failure metric with error message", async () => {
    await recordPipelineMetric({
      analysisId: "analysis-456",
      step: "combined_analysis",
      durationMs: 30000,
      usage: { inputTokens: 5000, outputTokens: 0 },
      model: "sonnet",
      success: false,
      errorMessage: "API timeout",
    });

    expect(mockValues).toHaveBeenCalledWith({
      analysisId: "analysis-456",
      step: "combined_analysis",
      durationMs: 30000,
      inputTokens: 5000,
      outputTokens: 0,
      model: "sonnet",
      success: false,
      errorMessage: "API timeout",
    });
  });
});
