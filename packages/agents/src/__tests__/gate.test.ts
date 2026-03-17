import { GateResultSchema } from "@redflag/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_ARTICLE_TEXT, SAMPLE_CONTRACT_TEXT } from "./fixtures/generate-pdf";

const mockCreate = vi.fn();

vi.mock("../client", () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODELS: { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6" },
  stripCodeFences: (t: string) => t,
}));

// Import after mock setup
const { relevanceGate } = await import("../gate");

function makeTextResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe("relevanceGate", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });
  it("returns isContract: true for contract text", async () => {
    const gateResponse = {
      isContract: true,
      contractType: "residential_lease",
      language: "en",
      reason: "This is a residential lease agreement between a landlord and tenant.",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(gateResponse)));

    const result = await relevanceGate(SAMPLE_CONTRACT_TEXT);

    expect(result.isContract).toBe(true);
    expect(result.contractType).toBe("residential_lease");
    expect(result.language).toBe("en");
    expect(GateResultSchema.safeParse(result).success).toBe(true);
  });

  it("returns isContract: false for non-contract text", async () => {
    const gateResponse = {
      isContract: false,
      contractType: null,
      language: "en",
      reason: "This is a recipe for chocolate cake, not a legal contract.",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(gateResponse)));

    const result = await relevanceGate(SAMPLE_ARTICLE_TEXT);

    expect(result.isContract).toBe(false);
    expect(result.contractType).toBeNull();
    expect(GateResultSchema.safeParse(result).success).toBe(true);
  });

  it("retries once on malformed response, then throws", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse("not valid json"));
    mockCreate.mockResolvedValueOnce(makeTextResponse("still not json"));

    await expect(relevanceGate("some text")).rejects.toThrow(
      /Relevance gate failed after 2 attempts/,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries once on API error, succeeds on second attempt", async () => {
    const gateResponse = {
      isContract: true,
      contractType: "nda",
      language: "en",
      reason: "This is a non-disclosure agreement.",
    };

    mockCreate.mockRejectedValueOnce(new Error("API rate limit"));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(gateResponse)));

    const result = await relevanceGate("some text");

    expect(result.isContract).toBe(true);
    expect(result.contractType).toBe("nda");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries once on Zod validation failure, then throws", async () => {
    // Missing required fields
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify({ isContract: true })));
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify({ foo: "bar" })));

    await expect(relevanceGate("some text")).rejects.toThrow(
      /Relevance gate failed after 2 attempts/,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("truncates text to 2000 characters", async () => {
    const longText = "a".repeat(5000);
    const gateResponse = {
      isContract: false,
      contractType: null,
      language: null,
      reason: "Unintelligible text.",
    };
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(gateResponse)));

    await relevanceGate(longText);

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const userMessage = callArgs.messages[0]?.content ?? "";
    expect(userMessage.length).toBeLessThan(longText.length);
  });
});
