import { describe, expect, it } from "vitest";
import { analyses, clauses, documents, knowledgePatterns, rateLimits } from "../schema";

describe("db schema", () => {
  it("exports all 5 tables", () => {
    expect(documents).toBeDefined();
    expect(analyses).toBeDefined();
    expect(clauses).toBeDefined();
    expect(knowledgePatterns).toBeDefined();
    expect(rateLimits).toBeDefined();
  });

  it("documents table has expected columns", () => {
    const cols = Object.keys(documents);
    expect(cols).toContain("id");
    expect(cols).toContain("filename");
    expect(cols).toContain("extractedText");
    expect(cols).toContain("storagePath");
  });

  it("knowledge_patterns table has embedding column", () => {
    const cols = Object.keys(knowledgePatterns);
    expect(cols).toContain("embedding");
  });
});
