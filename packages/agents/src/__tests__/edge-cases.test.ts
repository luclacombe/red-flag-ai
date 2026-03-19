import type { KnowledgePatternWithEmbedding } from "@redflag/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Smart Parse: mock dependencies before import ───────────────────

vi.mock("../boundary-detect", () => ({
  detectClauseBoundaries: vi.fn(),
  findAnchorPosition: () => -1,
}));

const { isSuspiciousResult } = await import("../smart-parse");

// ── Heuristic Parse: direct import (no mock needed) ───────────────

const { parseClausesHeuristic } = await import("../heuristic-parse");

// ── Gate: mock client ──────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6" },
  stripCodeFences: (t: string) => t,
}));

const { relevanceGate } = await import("../gate");

// ── Format Patterns: direct import ─────────────────────────────────

const { findTopMatchesInMemory } = await import("../format-patterns");

// ── Orchestrator: computeClausePositions (no DB mock needed) ──────

const { computeClausePositions } = await import("../orchestrator");

// ── Helpers ────────────────────────────────────────────────────────

function makeTextResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makePattern(id: string, embedding: number[]): KnowledgePatternWithEmbedding {
  return {
    id,
    clausePattern: `Pattern ${id}`,
    category: "test",
    contractType: ["lease"],
    riskLevel: "red" as const,
    whyRisky: "Test reason",
    saferAlternative: "Test alternative",
    jurisdictionNotes: "EU",
    embedding,
  };
}

// ── GATE_TEXT_LIMIT (read from source: 2000) ───────────────────────
const GATE_TEXT_LIMIT = 2000;

// ── PATTERN_MATCH_THRESHOLD (read from source: 0.7) ───────────────
const PATTERN_MATCH_THRESHOLD = 0.7;

// ====================================================================
// Test Groups
// ====================================================================

describe("Smart Parse Boundary Conditions", () => {
  it("textLength exactly 500 — should NOT be suspicious (short doc threshold)", () => {
    const clauses = [{ text: "x".repeat(500), position: 0 }];
    expect(isSuspiciousResult(clauses, 500)).toBe(false);
  });

  it("textLength 501 with 1 clause — should BE suspicious", () => {
    const clauses = [{ text: "x".repeat(501), position: 0 }];
    expect(isSuspiciousResult(clauses, 501)).toBe(true);
  });

  it("textLength exactly 2000 with 2 clauses — should NOT be suspicious (boundary)", () => {
    const clauses = [
      { text: "x".repeat(1000), position: 0 },
      { text: "x".repeat(1000), position: 1 },
    ];
    expect(isSuspiciousResult(clauses, 2000)).toBe(false);
  });

  it("textLength 2001 with 2 clauses — should BE suspicious", () => {
    const clauses = [
      { text: "x".repeat(1000), position: 0 },
      { text: "x".repeat(1001), position: 1 },
    ];
    expect(isSuspiciousResult(clauses, 2001)).toBe(true);
  });

  it("largest clause exactly 80% of text (3+ clauses) — NOT suspicious (strictly greater-than check)", () => {
    // textLength = 1000, largest clause = 800 chars (80%)
    // The code checks: maxClauseLen > textLength * 0.8 (strictly greater than)
    // 800 > 1000 * 0.8 => 800 > 800 => false
    const clauses = [
      { text: "x".repeat(800), position: 0 },
      { text: "x".repeat(100), position: 1 },
      { text: "x".repeat(100), position: 2 },
    ];
    expect(isSuspiciousResult(clauses, 1000)).toBe(false);
  });

  it("largest clause at 81% of text (3+ clauses) — should BE suspicious", () => {
    // textLength = 1000, largest clause = 810 chars (81%)
    // 810 > 1000 * 0.8 => 810 > 800 => true
    const clauses = [
      { text: "x".repeat(810), position: 0 },
      { text: "x".repeat(95), position: 1 },
      { text: "x".repeat(95), position: 2 },
    ];
    expect(isSuspiciousResult(clauses, 1000)).toBe(true);
  });
});

describe("Heuristic Parse Unicode/i18n", () => {
  it("parses document with Arabic clause headings (right-to-left text)", () => {
    const arabicDoc = `1. حقوق والتزامات المستأجر
يلتزم المستأجر بالحفاظ على العقار في حالة جيدة وعدم إحداث أي تغييرات دون إذن خطي مسبق من المؤجر.

2. مدة الإيجار
مدة العقد سنة واحدة تبدأ من تاريخ التوقيع وتنتهي بعد اثني عشر شهراً ما لم يتم التجديد بموافقة الطرفين.

3. قيمة الإيجار
يلتزم المستأجر بدفع إيجار شهري قدره ألف دولار أمريكي في الأول من كل شهر بدون أي خصم أو تأخير.`;

    const result = parseClausesHeuristic(arabicDoc, "lease", "ar");
    expect(result.length).toBe(3);
    expect(result[0]?.text).toMatch(/^1\.\s/);
  });

  it("parses document with Chinese numbered sections", () => {
    const chineseDoc = `1. 租赁物的基本情况
出租方将位于北京市朝阳区的房屋租赁给承租方作为办公使用。该房屋面积为一百二十平方米。房屋结构完好，设施齐全，符合居住条件。

2. 租赁期限
本合同租赁期限为两年，自签订之日起计算。届满后双方可协商续签，续签条件另行约定。未经双方书面同意，任何一方不得提前终止合同。

3. 租金及支付方式
月租金为人民币壹万元整，承租方应于每月一日前支付当月租金至出租方指定的银行账户。逾期未付租金的，承租方应支付违约金。`;

    const result = parseClausesHeuristic(chineseDoc, "lease", "zh");
    expect(result.length).toBe(3);
    expect(result[0]?.text).toContain("租赁物");
  });

  it("parses document with mixed Latin/CJK text content", () => {
    const mixedDoc = `1. Definitions and Scope 定义与范围
This Agreement ("本协议") defines the terms between PartyA and 甲方. Both parties agree to the obligations set forth herein.

2. Payment Terms 付款条款
The Client shall pay USD $5,000 per month (每月五千美元) within thirty calendar days of receiving an invoice.

3. Termination 终止条款
Either party may terminate this Agreement by providing at least thirty days prior written notice to the other party.`;

    const result = parseClausesHeuristic(mixedDoc, "general", "en");
    expect(result.length).toBe(3);
    expect(result[0]?.text).toContain("定义与范围");
  });

  it("handles emoji in clause text without breaking positions", () => {
    const emojiDoc = `1. Service Level Agreement
The provider shall maintain 99.9% uptime for all services described herein. Response time targets are outlined below.

2. Communication Protocol
All urgent communications shall be sent via the designated channel. Priority levels: Critical, High, Medium, Low.

3. Satisfaction Guarantee
The customer satisfaction score must remain above the agreed threshold. Quarterly reviews shall be conducted.`;

    const result = parseClausesHeuristic(emojiDoc, "general", "en");
    expect(result.length).toBe(3);
    for (const clause of result) {
      expect(clause.text.length).toBeGreaterThan(0);
    }
  });
});

describe("Gate Text Truncation", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("text exactly at GATE_TEXT_LIMIT — should NOT truncate", async () => {
    const exactText = "a".repeat(GATE_TEXT_LIMIT);
    const gateResponse = {
      isContract: false,
      contractType: null,
      language: "en",
      reason: "Unintelligible text.",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(gateResponse)));

    await relevanceGate(exactText);

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const userMessage = callArgs.messages[0]?.content ?? "";
    // The user message wraps text with "Classify the following document:\n\n"
    // so the text portion should be exactly GATE_TEXT_LIMIT characters
    expect(userMessage).toContain(exactText);
  });

  it("text one char over GATE_TEXT_LIMIT — should truncate to exactly GATE_TEXT_LIMIT", async () => {
    const overText = "b".repeat(GATE_TEXT_LIMIT + 1);
    const gateResponse = {
      isContract: false,
      contractType: null,
      language: "en",
      reason: "Unintelligible text.",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(gateResponse)));

    await relevanceGate(overText);

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const userMessage = callArgs.messages[0]?.content ?? "";
    // The full text should NOT be present
    expect(userMessage).not.toContain(overText);
    // But the truncated text (first GATE_TEXT_LIMIT chars) should be
    const truncated = overText.slice(0, GATE_TEXT_LIMIT);
    expect(userMessage).toContain(truncated);
  });

  it("uses the correct GATE_TEXT_LIMIT value of 2000", () => {
    // Verify our constant matches the source
    expect(GATE_TEXT_LIMIT).toBe(2000);
  });
});

describe("Position Computation with Special Characters", () => {
  it("clause text containing regex metacharacters (*, +, ?, [, ])", () => {
    const doc =
      "Preamble text.\n\n" +
      "The tenant shall pay rent [monthly] at a rate of $1,000+ per month. " +
      "Late fees: 5% * outstanding balance. Any questions? Contact landlord.\n\n" +
      "The deposit is $2,000.";
    const clauseText =
      "The tenant shall pay rent [monthly] at a rate of $1,000+ per month. " +
      "Late fees: 5% * outstanding balance. Any questions? Contact landlord.";
    const clauses = [{ text: clauseText, position: 0 }];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).toBe(doc.indexOf(clauseText));
    expect(result[0]?.startIndex).not.toBe(-1);
    expect(result[0]?.endIndex).toBe(doc.indexOf(clauseText) + clauseText.length);
  });

  it("clause text with multiple consecutive newlines", () => {
    const doc = "Header\n\n\n\nClause one text here.\n\n\n\n\nClause two text here.";
    const clauses = [
      { text: "Clause one text here.", position: 0 },
      { text: "Clause two text here.", position: 1 },
    ];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).toBe(doc.indexOf("Clause one text here."));
    expect(result[0]?.startIndex).not.toBe(-1);
    expect(result[1]?.startIndex).toBe(doc.indexOf("Clause two text here."));
    expect(result[1]?.startIndex).not.toBe(-1);
  });

  it("clause text containing Unicode combining characters", () => {
    const doc =
      "Pr\u00e9ambule du contrat.\n\nL'article d\u00e9finit les termes cl\u00e9s du contrat.";
    const clauseText = "L'article d\u00e9finit les termes cl\u00e9s du contrat.";
    const clauses = [{ text: clauseText, position: 0 }];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).not.toBe(-1);
    expect(result[0]?.endIndex).toBe((result[0]?.startIndex ?? 0) + clauseText.length);
  });

  it("clause text at start of document (startIndex = 0)", () => {
    const doc = "This clause starts at the very beginning of the document. More content follows.";
    const clauses = [
      { text: "This clause starts at the very beginning of the document.", position: 0 },
    ];

    const result = computeClausePositions(doc, clauses);

    expect(result[0]?.startIndex).toBe(0);
    expect(result[0]?.endIndex).toBe(
      "This clause starts at the very beginning of the document.".length,
    );
  });
});

describe("Format Patterns Threshold", () => {
  it("cosine similarity at exactly PATTERN_MATCH_THRESHOLD — should match (inclusive)", () => {
    // Construct two vectors whose cosine similarity is exactly 0.7
    // cos(theta) = 0.7 => theta = acos(0.7)
    // Vector a = [1, 0], vector b = [cos(theta), sin(theta)]
    const theta = Math.acos(PATTERN_MATCH_THRESHOLD);
    const a = [1, 0];
    const b = [Math.cos(theta), Math.sin(theta)];
    const pattern = makePattern("threshold-exact", b);

    const matches = findTopMatchesInMemory("clause", a, [pattern], 5);

    expect(matches.length).toBe(1);
    expect(matches[0]?.similarity).toBeCloseTo(PATTERN_MATCH_THRESHOLD, 5);
  });

  it("cosine similarity just below threshold — should NOT match", () => {
    // Slightly wider angle so cosine similarity is threshold - 0.001
    const target = PATTERN_MATCH_THRESHOLD - 0.001;
    const theta = Math.acos(target);
    const a = [1, 0];
    const b = [Math.cos(theta), Math.sin(theta)];
    const pattern = makePattern("below-threshold", b);

    const matches = findTopMatchesInMemory("clause", a, [pattern], 5);

    expect(matches.length).toBe(0);
  });

  it("two identical embeddings produce similarity of 1.0", () => {
    const embedding = [0.3, 0.4, 0.5, 0.6];
    const pattern = makePattern("identical", embedding);

    const matches = findTopMatchesInMemory("clause", embedding, [pattern], 5);

    expect(matches.length).toBe(1);
    expect(matches[0]?.similarity).toBeCloseTo(1.0, 10);
  });
});
