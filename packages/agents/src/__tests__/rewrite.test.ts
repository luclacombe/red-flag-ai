import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-5-20250514" },
}));

const { rewriteClause } = await import("../rewrite");

function makeTextResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

describe("rewriteClause", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns rewritten clause text", async () => {
    const response = {
      saferAlternative: "The landlord may enter with 48 hours written notice.",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await rewriteClause(
      "Landlord may enter at any time.",
      "red",
      "No notice requirement.",
      "en",
    );

    expect(result).toBe("The landlord may enter with 48 hours written notice.");
  });

  it("retries on malformed response, then throws", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse("not json"));
    mockCreate.mockResolvedValueOnce(makeTextResponse("{}"));

    await expect(rewriteClause("clause", "red", "explanation", "en")).rejects.toThrow(
      /Rewrite agent failed after 2 attempts/,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries on API error, succeeds on second attempt", async () => {
    const response = { saferAlternative: "Better clause." };
    mockCreate.mockRejectedValueOnce(new Error("rate limit"));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    const result = await rewriteClause("bad clause", "yellow", "vague", "en");
    expect(result).toBe("Better clause.");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects empty saferAlternative", async () => {
    const response = { saferAlternative: "" };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await expect(rewriteClause("clause", "red", "reason", "en")).rejects.toThrow(
      /Rewrite agent failed after 2 attempts/,
    );
  });

  it("passes risk context to the prompt", async () => {
    const response = { saferAlternative: "Rewritten." };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(response)));

    await rewriteClause("original clause", "yellow", "vague wording", "fr");

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(callArgs.messages[0]?.content).toContain("yellow");
    expect(callArgs.messages[0]?.content).toContain("vague wording");
    expect(callArgs.messages[0]?.content).toContain("fr");
  });
});
