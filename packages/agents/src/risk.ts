import type { SimilarPattern } from "@redflag/db";
import { type PositionedClause, RiskLevelSchema } from "@redflag/shared";
import { z } from "zod";
import { getAnthropicClient, MODELS } from "./client";
import { buildRiskUserMessage, RISK_SYSTEM_PROMPT } from "./prompts/risk";

// Internal schema — what Claude returns (no positions, no saferAlternative, no matchedPatterns)
const RiskAnalysisResultSchema = z.object({
  riskLevel: RiskLevelSchema,
  explanation: z.string(),
  category: z.string(),
});

export type RiskAnalysisResult = z.infer<typeof RiskAnalysisResultSchema>;

/**
 * Risk agent — evaluates a single clause for potential risks.
 * Uses Claude Sonnet with RAG patterns as context.
 *
 * @param clause - Positioned clause with text and character offsets
 * @param patterns - Similar predatory patterns from knowledge base
 * @param language - Document language code
 * @returns Risk analysis result (level, explanation, category)
 * @throws Error if both attempts fail
 */
export async function analyzeClause(
  clause: PositionedClause,
  patterns: SimilarPattern[],
  language: string,
): Promise<RiskAnalysisResult> {
  const client = getAnthropicClient();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODELS.sonnet,
        max_tokens: 1024,
        system: RISK_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildRiskUserMessage(clause.text, patterns, language) },
        ],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in Claude response");
      }

      const parsed = JSON.parse(textBlock.text) as unknown;
      return RiskAnalysisResultSchema.parse(parsed);
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Risk agent failed after 2 attempts: ${message}`);
}
