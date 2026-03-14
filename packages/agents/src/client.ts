import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/**
 * Shared Anthropic client — lazily initialized, reused across agent calls.
 * Reads ANTHROPIC_API_KEY from environment.
 */
export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/** Model IDs — centralized so agents don't hardcode strings */
export const MODELS = {
  /** Fast/cheap — used for relevance gate */
  haiku: "claude-haiku-4-5-20251001",
  /** Capable — used for parse, risk, rewrite, summary agents */
  sonnet: "claude-sonnet-4-5-20250514",
} as const;
