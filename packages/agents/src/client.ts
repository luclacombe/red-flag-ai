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

/** Model IDs — centralized so agents don't hardcode strings */
export const MODELS = {
  /** Fast/cheap — used for relevance gate */
  haiku: "claude-haiku-4-5-20251001",
  /** Capable — used for parse, risk, rewrite, summary agents */
  sonnet: "claude-sonnet-4-6",
} as const;
