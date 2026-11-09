import { describe, expect, it } from "vitest";
import { buildCombinedSystemPrompt } from "../prompts/combined-analysis";
import { buildSummaryUserMessage } from "../prompts/summary";

describe("buildCombinedSystemPrompt with responseLanguage", () => {
  it("includes separate document and response language instructions", () => {
    const prompt = buildCombinedSystemPrompt("", "lease", "fr", "en");

    expect(prompt).toContain("Document language: fr");
    expect(prompt).toContain("Response language: en");
    expect(prompt).toContain("## Explanations (in en)");
    expect(prompt).toContain("## Category (in en)");
    expect(prompt).toContain("## saferAlternative (in fr)");
    expect(prompt).toContain("Explanations, categories and topConcerns are in en");
    expect(prompt).toContain("saferAlternative is in fr");
  });

  it("handles same document and response language", () => {
    const prompt = buildCombinedSystemPrompt("", "nda", "de", "de");

    expect(prompt).toContain("Document language: de");
    expect(prompt).toContain("Response language: de");
    expect(prompt).toContain("## saferAlternative (in de)");
    expect(prompt).toContain("Explanations, categories and topConcerns are in de");
  });

  it("includes RAG patterns text", () => {
    const ragText = "## Known Risk Patterns\n\n- Pattern 1";
    const prompt = buildCombinedSystemPrompt(ragText, "lease", "en", "fr");

    expect(prompt).toContain(ragText);
  });
});

describe("buildSummaryUserMessage with responseLanguage", () => {
  const analyses = [
    {
      riskLevel: "red",
      explanation: "Bad clause.",
      category: "liability",
      clauseText: "The tenant...",
    },
    { riskLevel: "green", explanation: "OK.", category: "rent", clauseText: "Rent is $1000." },
  ];

  it("includes response language instruction", () => {
    const msg = buildSummaryUserMessage(analyses, "lease", "fr", "en");

    expect(msg).toContain("Document language: fr");
    expect(msg).toContain("Response language: en");
    expect(msg).toContain("Write the topConcerns in en");
  });

  it("includes clause data", () => {
    const msg = buildSummaryUserMessage(analyses, "lease", "en", "fr");

    expect(msg).toContain("Red flags: 1");
    expect(msg).toContain("Green: 1");
    expect(msg).toContain("[RED]");
  });
});
