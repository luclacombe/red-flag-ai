import { VOYAGE_DIMENSIONS } from "@redflag/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embedText, embedTexts } from "../embeddings";

// Mock a valid 1024-dimensional embedding
function mockEmbedding(seed = 0.1): number[] {
  return Array.from({ length: VOYAGE_DIMENSIONS }, (_, i) =>
    Number.parseFloat(((Math.sin(i + seed) + 1) / 2).toFixed(6)),
  );
}

function mockVoyageResponse(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      embedding: mockEmbedding(i),
    })),
    usage: { total_tokens: count * 10 },
  };
}

describe("embeddings", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.VOYAGE_API_KEY;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-voyage-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.VOYAGE_API_KEY = originalEnv;
    } else {
      delete process.env.VOYAGE_API_KEY;
    }
  });

  describe("embedText", () => {
    it("returns a 1024-dimensional embedding for a single text", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockVoyageResponse(1)),
      });

      const result = await embedText("test clause", "document");

      expect(result).toHaveLength(VOYAGE_DIMENSIONS);
      expect(globalThis.fetch).toHaveBeenCalledOnce();

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const [url, options] = call ?? [];
      expect(url).toBe("https://api.voyageai.com/v1/embeddings");
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.model).toBe("voyage-law-2");
      expect(body.input).toEqual(["test clause"]);
      expect(body.input_type).toBe("document");
    });

    it("passes query input_type for clause search", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockVoyageResponse(1)),
      });

      await embedText("search query", "query");

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const [, options] = call ?? [];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.input_type).toBe("query");
    });

    it("sends Authorization header with API key", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockVoyageResponse(1)),
      });

      await embedText("test", "document");

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const [, options] = call ?? [];
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-voyage-key");
    });

    it("throws if VOYAGE_API_KEY is not set", async () => {
      delete process.env.VOYAGE_API_KEY;
      await expect(embedText("test", "document")).rejects.toThrow("VOYAGE_API_KEY");
    });

    it("retries once on API error, then throws", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: () => Promise.resolve({ detail: "Internal Server Error" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: () => Promise.resolve({ detail: "Internal Server Error" }),
        });

      await expect(embedText("test", "document")).rejects.toThrow("Voyage API error (500)");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("succeeds on retry after first failure", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          json: () => Promise.resolve({ detail: "Service Unavailable" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockVoyageResponse(1)),
        });

      const result = await embedText("test", "document");
      expect(result).toHaveLength(VOYAGE_DIMENSIONS);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("embedTexts", () => {
    it("embeds multiple texts in a single batch call", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockVoyageResponse(3)),
      });

      const result = await embedTexts(["clause 1", "clause 2", "clause 3"], "document");

      expect(result).toHaveLength(3);
      for (const embedding of result) {
        expect(embedding).toHaveLength(VOYAGE_DIMENSIONS);
      }
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    it("returns empty array for empty input", async () => {
      const result = await embedTexts([], "document");
      expect(result).toEqual([]);
    });

    it("throws if batch exceeds 128 texts", async () => {
      const texts = Array.from({ length: 129 }, (_, i) => `text ${i}`);
      await expect(embedTexts(texts, "document")).rejects.toThrow("max 128 texts");
    });
  });
});
