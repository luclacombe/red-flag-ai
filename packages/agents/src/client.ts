import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/** OpenRouter's Anthropic-compatible endpoint. The SDK appends `/v1/messages`. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/**
 * Shared Anthropic SDK client, routed through OpenRouter.
 * Lazily initialized, reused across agent calls. Reads OPENROUTER_API_KEY from environment.
 *
 * OpenRouter speaks the Anthropic Messages API (streaming, tool_use, strict tools),
 * so the agents keep using the Anthropic SDK unchanged. The key is sent as
 * `Authorization: Bearer`, which is what OpenRouter expects (not `x-api-key`).
 */
export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  _client = new Anthropic({
    baseURL: OPENROUTER_BASE_URL,
    authToken: apiKey,
    apiKey: null,
    defaultHeaders: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://www.red-flag-ai.com",
      "X-Title": "RedFlag AI",
    },
  });
  return _client;
}

/**
 * Strip markdown code fences from Claude responses.
 * Claude sometimes wraps JSON in ```json ... ``` even when told not to.
 * Also trims leading/trailing whitespace for robustness.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  return trimmed
    .replace(/^```(?:\w+)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/** Model IDs (OpenRouter slugs) — centralized so agents don't hardcode strings */
export const MODELS = {
  /** Fast/cheap — used for relevance gate + boundary detection */
  haiku: "anthropic/claude-haiku-4.5",
  /** Capable — used for combined analysis + summary */
  sonnet: "anthropic/claude-sonnet-4.6",
} as const;
