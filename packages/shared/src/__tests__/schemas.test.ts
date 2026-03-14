import { describe, expect, it } from "vitest";
import {
  ClauseAnalysisSchema,
  GateResultSchema,
  MAX_PAGES,
  SSEEventSchema,
  SummarySchema,
  VOYAGE_DIMENSIONS,
} from "../index";

describe("shared schemas", () => {
  it("exports constants", () => {
    expect(MAX_PAGES).toBe(30);
    expect(VOYAGE_DIMENSIONS).toBe(1024);
  });

  it("validates a ClauseAnalysis", () => {
    const result = ClauseAnalysisSchema.safeParse({
      clauseText: "The tenant shall pay rent.",
      startIndex: 0,
      endIndex: 26,
      position: 0,
      riskLevel: "green",
      explanation: "Standard clause.",
      saferAlternative: null,
      category: "payment",
      matchedPatterns: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid risk level", () => {
    const result = ClauseAnalysisSchema.safeParse({
      clauseText: "test",
      startIndex: 0,
      endIndex: 4,
      position: 0,
      riskLevel: "blue",
      explanation: "test",
      saferAlternative: null,
      category: "test",
      matchedPatterns: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates a GateResult", () => {
    const result = GateResultSchema.safeParse({
      isContract: true,
      contractType: "lease",
      language: "en",
      reason: "Contains rental terms.",
    });
    expect(result.success).toBe(true);
  });

  it("validates SSE events as discriminated union", () => {
    const statusEvent = SSEEventSchema.safeParse({
      type: "status",
      message: "Analyzing...",
    });
    expect(statusEvent.success).toBe(true);

    const errorEvent = SSEEventSchema.safeParse({
      type: "error",
      message: "Something went wrong",
      recoverable: false,
    });
    expect(errorEvent.success).toBe(true);
  });

  it("validates a Summary", () => {
    const result = SummarySchema.safeParse({
      overallRiskScore: 75,
      recommendation: "caution",
      topConcerns: ["Broad termination clause"],
      clauseBreakdown: { red: 2, yellow: 3, green: 5 },
      language: "en",
      contractType: "lease",
    });
    expect(result.success).toBe(true);
  });
});
