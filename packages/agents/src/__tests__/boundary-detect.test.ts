import { beforeEach, describe, expect, it, vi } from "vitest";
import { findAnchorPosition, splitAtAnchors } from "../boundary-detect";

// ── Mock Anthropic client ──────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6" },
}));

const { detectClauseBoundaries } = await import("../boundary-detect");

// ── Tests ──────────────────────────────────────────────────────────

describe("findAnchorPosition", () => {
  it("finds exact match", () => {
    const text = "This is a contract. 1.1 The tenant shall pay rent monthly.";
    expect(findAnchorPosition(text, "1.1 The tenant shall pay rent monthly.", 0)).toBe(20);
  });

  it("finds match with forward-searching (skips earlier occurrences)", () => {
    const text = "The tenant shall pay. The tenant shall maintain. The tenant shall notify.";
    expect(findAnchorPosition(text, "The tenant shall maintain.", 22)).toBe(22);
  });

  it("finds match with normalized whitespace", () => {
    // PDF extraction might produce different whitespace than what Haiku copies
    const text = "1.1  The   premises\nThe unit located at the address";
    expect(findAnchorPosition(text, "1.1 The premises The unit located", 0)).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("returns -1 for anchor shorter than minimum length", () => {
    const text = "This is a contract with many clauses and sections.";
    expect(findAnchorPosition(text, "Short", 0)).toBe(-1);
  });

  it("returns -1 when anchor is not in document", () => {
    const text = "This is a contract about rental terms and conditions for the apartment.";
    expect(
      findAnchorPosition(text, "This text does not appear anywhere in this document at all", 0),
    ).toBe(-1);
  });

  it("respects searchFrom parameter", () => {
    const text = "Clause A: terms. Clause A: more terms. Clause B: other terms.";
    // First "Clause A" is at 0, second is at 17
    const pos = findAnchorPosition(text, "Clause A: more terms.", 10);
    expect(pos).toBe(17);
  });
});

describe("splitAtAnchors", () => {
  const contractText =
    "RESIDENTIAL LEASE AGREEMENT " +
    "Parties: The landlord and the tenant have agreed as follows. " +
    "1.1 Premises The self-contained unit located at 88 Birch Court in Springfield. " +
    "1.2 Duration of the lease The agreement is entered into for a period of twelve months. " +
    "1.3 Payment obligations The monthly rent shall be USD 1800 per month excluding service charges. " +
    "2. Maintenance The maintenance of the unit is the responsibility of the landlord.";

  it("splits document at anchor positions", () => {
    const anchors = [
      "1.1 Premises The self-contained unit",
      "1.2 Duration of the lease The agreement",
      "1.3 Payment obligations The monthly rent",
      "2. Maintenance The maintenance of the unit",
    ];
    const clauses = splitAtAnchors(contractText, anchors);

    expect(clauses.length).toBe(4);
    expect(clauses[0]?.text).toContain("Premises");
    expect(clauses[0]?.text).toContain("Springfield");
    expect(clauses[1]?.text).toContain("Duration of the lease");
    expect(clauses[2]?.text).toContain("Payment obligations");
    expect(clauses[3]?.text).toContain("Maintenance");
  });

  it("assigns sequential zero-based positions", () => {
    const anchors = [
      "1.1 Premises The self-contained unit",
      "1.3 Payment obligations The monthly rent",
    ];
    const clauses = splitAtAnchors(contractText, anchors);

    expect(clauses[0]?.position).toBe(0);
    expect(clauses[1]?.position).toBe(1);
  });

  it("returns empty for empty anchors", () => {
    expect(splitAtAnchors(contractText, [])).toHaveLength(0);
  });

  it("skips anchors that are not found", () => {
    const anchors = [
      "1.1 Premises The self-contained unit",
      "This anchor does not exist anywhere in this document text at all",
      "2. Maintenance The maintenance of the unit",
    ];
    const clauses = splitAtAnchors(contractText, anchors);

    // Only 2 anchors found (skipped the missing one)
    expect(clauses.length).toBe(2);
    expect(clauses[0]?.text).toContain("Premises");
    expect(clauses[1]?.text).toContain("Maintenance");
  });

  it("skips anchors shorter than minimum length", () => {
    const anchors = ["Short", "1.1 Premises The self-contained unit"];
    const clauses = splitAtAnchors(contractText, anchors);

    expect(clauses.length).toBe(1);
    expect(clauses[0]?.text).toContain("Premises");
  });

  it("merges short fragments into previous clause", () => {
    // "2. Onderhoud" section is short enough, followed by a very short fragment
    const text =
      "1. First clause with enough text to be well above the minimum threshold for clause length. " +
      "OK. " +
      "2. Second clause also with enough text to exceed the minimum threshold for clause splitting.";
    const anchors = ["1. First clause with enough text", "OK. 2. Second clause also with"];
    const clauses = splitAtAnchors(text, anchors);

    // Should be 2 clauses (the "OK." part is too short to be standalone but gets included in surrounding clauses)
    expect(clauses.length).toBe(2);
  });

  it("handles single-line PDF text (no newlines)", () => {
    // Simulates PDF extraction where everything is one line
    const singleLine =
      "LEASE AGREEMENT " +
      "1. PREMISES The landlord hereby leases to tenant the property located at 123 Main Street for residential use only. " +
      "2. RENT Tenant shall pay monthly rent of one thousand five hundred dollars on or before the first day of each month. " +
      "3. DEPOSIT Tenant shall pay a security deposit equal to two months rent upon signing this agreement.";

    const anchors = [
      "1. PREMISES The landlord hereby leases",
      "2. RENT Tenant shall pay monthly rent",
      "3. DEPOSIT Tenant shall pay a security",
    ];
    const clauses = splitAtAnchors(singleLine, anchors);

    expect(clauses.length).toBe(3);
    expect(clauses[0]?.text).toContain("PREMISES");
    expect(clauses[1]?.text).toContain("RENT");
    expect(clauses[2]?.text).toContain("DEPOSIT");
  });

  it("handles duplicate phrases with forward-searching", () => {
    const text =
      "The tenant shall comply with the following terms: " +
      "1. The tenant shall pay rent on time every month without exception. " +
      "2. The tenant shall maintain the property in good condition at all times.";

    const anchors = [
      "1. The tenant shall pay rent on time",
      "2. The tenant shall maintain the property",
    ];
    const clauses = splitAtAnchors(text, anchors);

    expect(clauses.length).toBe(2);
    expect(clauses[0]?.text).toContain("pay rent");
    expect(clauses[1]?.text).toContain("maintain the property");
  });
});

describe("detectClauseBoundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls Haiku with report_boundaries tool and strict: true", async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 200, output_tokens: 100 },
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "report_boundaries",
          input: {
            clauseAnchors: [
              { anchor: "1. PREMISES The landlord hereby leases to tenant" },
              { anchor: "2. RENT Tenant shall pay monthly rent of" },
              { anchor: "3. DEPOSIT Tenant shall pay a security deposit" },
            ],
          },
        },
      ],
    });

    const text =
      "LEASE AGREEMENT Between the parties. " +
      "1. PREMISES The landlord hereby leases to tenant the property located at the address. " +
      "2. RENT Tenant shall pay monthly rent of one thousand dollars on or before the first. " +
      "3. DEPOSIT Tenant shall pay a security deposit equal to two months rent upon signing.";

    const result = await detectClauseBoundaries(text, "lease", "en");

    // Verify the API call
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0]?.[0];
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    expect(callArgs.max_tokens).toBe(2048);
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "report_boundaries" });

    // Verify tool has strict: true
    const tool = callArgs.tools[0];
    expect(tool.name).toBe("report_boundaries");
    expect(tool.strict).toBe(true);
    expect(tool.input_schema.additionalProperties).toBe(false);

    // Verify clauseAnchors schema structure
    expect(tool.input_schema.properties.clauseAnchors.type).toBe("array");
    expect(tool.input_schema.properties.clauseAnchors.items.properties.anchor.type).toBe("string");

    // Verify clauses were produced
    expect(result.length).toBe(3);
    expect(result[0]?.position).toBe(0);
    expect(result[1]?.position).toBe(1);
    expect(result[2]?.position).toBe(2);
    expect(result[0]?.text).toContain("PREMISES");
    expect(result[1]?.text).toContain("RENT");
    expect(result[2]?.text).toContain("DEPOSIT");
  });

  it("sends raw document text (no line numbering)", async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 200, output_tokens: 100 },
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "report_boundaries",
          input: {
            clauseAnchors: [{ anchor: "1. First clause with enough text to be valid" }],
          },
        },
      ],
    });

    const text =
      "Preamble text. 1. First clause with enough text to be valid and meaningful for analysis.";
    await detectClauseBoundaries(text, "residential_lease", "nl");

    const userMessage = mockCreate.mock.calls[0]?.[0].messages[0].content;
    // Should NOT contain L1:, L2: etc (old line-number format)
    expect(userMessage).not.toContain("L1:");
    // Should contain the raw text
    expect(userMessage).toContain("First clause");
    expect(userMessage).toContain("residential_lease");
    expect(userMessage).toContain("nl");
  });

  it("retries on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API timeout")).mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "report_boundaries",
          input: {
            clauseAnchors: [
              { anchor: "1. First clause with enough text to pass the minimum" },
              { anchor: "2. Second clause with enough text to pass the minimum" },
            ],
          },
        },
      ],
    });

    const text =
      "Preamble. 1. First clause with enough text to pass the minimum length requirement. " +
      "2. Second clause with enough text to pass the minimum length requirement here.";
    const result = await detectClauseBoundaries(text, "lease", "en");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(2);
  });

  it("throws after 2 failed attempts", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("Fail 1"))
      .mockRejectedValueOnce(new Error("Fail 2"));

    const text = "Some contract text that is long enough to be meaningful for the detector.";

    await expect(detectClauseBoundaries(text, "lease", "en")).rejects.toThrow(
      "Boundary detection failed after 2 attempts",
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws when no tool_use block in response", async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "I cannot find boundaries" }],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Still no boundaries" }],
      });

    const text = "Some contract text that is long enough to be meaningful for the detector.";

    await expect(detectClauseBoundaries(text, "lease", "en")).rejects.toThrow(
      "Boundary detection failed after 2 attempts",
    );
  });
});
