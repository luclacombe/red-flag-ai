import { logger, ParseClausesResponseSchema, type ParsedClause } from "@redflag/shared";
import { getAnthropicClient, MODELS, stripCodeFences } from "./client";
import { buildParseUserMessage, PARSE_SYSTEM_PROMPT } from "./prompts/parse";

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

  logger.info("Parse starting", { contractType, language, textLen: text.length });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) logger.info("Parse retry", { attempt: attempt + 1 });
      const response = await client.messages.create({
        model: MODELS.sonnet,
        max_tokens: 4096,
        system: PARSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildParseUserMessage(text, contractType, language) }],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in Claude response");
      }

      logger.info("Parse response received", { responseLen: textBlock.text.length });

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
