import { ParsedClauseSchema } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6" },
  stripCodeFences: (t: string) => t,
}));

const { parseClauses } = await import("../parse");

function makeTextResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

describe("parseClauses", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("parses valid clause response", async () => {
    const response = {
      clauses: [
        { text: "1. RENT. Tenant shall pay $1000 monthly.", position: 0 },
        { text: "2. DEPOSIT. A security deposit of $2000 is required.", position: 1 },
      ],
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await parseClauses("full text", "residential_lease", "en");

    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("1. RENT. Tenant shall pay $1000 monthly.");
    expect(result[0]?.position).toBe(0);
    expect(ParsedClauseSchema.safeParse(result[0]).success).toBe(true);
  });

  it("retries once on malformed JSON, then throws", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse("not json"));
    mockCreate.mockResolvedValueOnce(makeTextResponse("still not json"));

    await expect(parseClauses("text", "nda", "en")).rejects.toThrow(
      /Parse agent failed after 2 attempts/,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries on API error, succeeds on second attempt", async () => {
    const response = {
      clauses: [{ text: "Clause text.", position: 0 }],
    };
    mockCreate.mockRejectedValueOnce(new Error("API error"));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await parseClauses("text", "nda", "en");
    expect(result).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects Zod-invalid response (missing fields)", async () => {
    const invalid = { clauses: [{ text: "" }] };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(invalid)));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(invalid)));

    await expect(parseClauses("text", "lease", "en")).rejects.toThrow(
      /Parse agent failed after 2 attempts/,
    );
  });

  it("handles empty clauses array", async () => {
    const response = { clauses: [] };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await parseClauses("text", "lease", "en");
    expect(result).toHaveLength(0);
  });

  it("passes contractType and language to the prompt", async () => {
    const response = { clauses: [{ text: "Clause.", position: 0 }] };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await parseClauses("doc text", "employment", "fr");

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(callArgs.messages[0]?.content).toContain("employment");
    expect(callArgs.messages[0]?.content).toContain("fr");
  });
});
