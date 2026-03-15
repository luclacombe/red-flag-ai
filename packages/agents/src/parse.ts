import { logger, ParseClausesResponseSchema, type ParsedClause } from "@redflag/shared";
import { getAnthropicClient, MODELS, stripCodeFences } from "./client";
import { buildParseUserMessage, PARSE_SYSTEM_PROMPT } from "./prompts/parse";

/**
 * Estimate output tokens needed for a document.
 * The parse output must contain all clause texts verbatim (≈ the full document),
 * plus JSON overhead. Rough ratio: 1 token ≈ 4 characters.
 * We add a generous buffer for JSON structure + multilingual token expansion.
 */
function estimateMaxTokens(textLen: number): number {
  // Estimate: document chars / 3 (conservative for non-English) + 512 for JSON overhead
  const estimated = Math.ceil(textLen / 3) + 512;
  // Clamp between 4096 (small docs) and 32768 (very large docs)
  return Math.min(32768, Math.max(4096, estimated));
}

/**
 * Parse agent — splits contract text into individual clauses.
 * Uses Claude Sonnet to identify clause boundaries and extract verbatim text.
 *
 * @param text - Full extracted text from the PDF
 * @param contractType - Type of contract (e.g. "residential_lease", "nda")
 * @param language - Document language code (e.g. "en", "fr")
 * @returns Array of parsed clauses with text and position (no character offsets)
 * @throws Error if both attempts fail
 */
export async function parseClauses(
  text: string,
  contractType: string,
  language: string,
): Promise<ParsedClause[]> {
  const client = getAnthropicClient();
  let lastError: unknown;

  const baseMaxTokens = estimateMaxTokens(text.length);
  logger.info("Parse starting", {
    contractType,
    language,
    textLen: text.length,
    maxTokens: baseMaxTokens,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    // On retry after truncation, increase the budget by 50%
    const maxTokens =
      attempt === 0 ? baseMaxTokens : Math.min(32768, Math.ceil(baseMaxTokens * 1.5));

    try {
      if (attempt > 0) logger.info("Parse retry", { attempt: attempt + 1, maxTokens });
      const response = await client.messages.create({
        model: MODELS.sonnet,
        max_tokens: maxTokens,
        system: PARSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildParseUserMessage(text, contractType, language) }],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in Claude response");
      }

      logger.info("Parse response received", {
        responseLen: textBlock.text.length,
        stopReason: response.stop_reason,
        outputTokens: response.usage.output_tokens,
        maxTokens,
      });

      // Detect truncation — Claude hit the token limit before finishing JSON
      if (response.stop_reason === "max_tokens") {
        throw new Error(
          `Response truncated at ${response.usage.output_tokens} tokens (limit: ${maxTokens}). Document may be too large for single-pass parsing.`,
        );
      }

      const parsed = JSON.parse(stripCodeFences(textBlock.text)) as unknown;
      const result = ParseClausesResponseSchema.parse(parsed);
      logger.info("Parse complete", { clauseCount: result.clauses.length });
      return result.clauses;
    } catch (error) {
      logger.error("Parse attempt failed", {
        step: "parse",
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
        retried: attempt === 0,
      });
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Parse agent failed after 2 attempts: ${message}`);
}
