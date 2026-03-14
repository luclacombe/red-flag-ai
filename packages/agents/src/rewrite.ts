import { z } from "zod";
import { getAnthropicClient, MODELS } from "./client";
import { buildRewriteUserMessage, REWRITE_SYSTEM_PROMPT } from "./prompts/rewrite";

const RewriteResponseSchema = z.object({
  saferAlternative: z.string().min(1),
});

/**
 * Rewrite agent — generates a fairer version of a flagged clause.
 * Only called for red/yellow clauses (orchestrator handles this logic).
 *
 * @param clauseText - Original clause text
 * @param riskLevel - Risk level ("red" or "yellow")
 * @param explanation - Why the clause is risky
 * @param language - Document language code
 * @returns Rewritten clause text
 * @throws Error if both attempts fail
 */
export async function rewriteClause(
  clauseText: string,
  riskLevel: string,
  explanation: string,
  language: string,
): Promise<string> {
  const client = getAnthropicClient();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODELS.sonnet,
        max_tokens: 1024,
        system: REWRITE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildRewriteUserMessage(clauseText, riskLevel, explanation, language),
          },
        ],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in Claude response");
      }

      const parsed = JSON.parse(textBlock.text) as unknown;
      const result = RewriteResponseSchema.parse(parsed);
      return result.saferAlternative;
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Rewrite agent failed after 2 attempts: ${message}`);
}
