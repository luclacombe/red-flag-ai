import { logger, RecommendationSchema, type Summary } from "@redflag/shared";
import { z } from "zod";
import { getAnthropicClient, MODELS, stripCodeFences } from "./client";
import { buildSummaryUserMessage, SUMMARY_SYSTEM_PROMPT } from "./prompts/summary";

// What Claude returns — no clauseBreakdown (computed by orchestrator)
const SummaryResponseSchema = z.object({
  overallRiskScore: z.number().int().min(0).max(100),
  recommendation: RecommendationSchema,
  topConcerns: z.array(z.string()),
  language: z.string(),
  contractType: z.string(),
});

interface ClauseForSummary {
  riskLevel: string;
  explanation: string;
  category: string;
  clauseText: string;
}

/**
 * Summary agent — aggregates clause analyses into an overall risk assessment.
 * Uses Claude Sonnet to generate a holistic summary.
 *
 * @param analyses - All clause analyses from the pipeline
 * @param contractType - Type of contract
 * @param language - Document language code
 * @returns Summary without clauseBreakdown (orchestrator computes it deterministically)
 * @throws Error if both attempts fail
 */
export async function summarize(
  analyses: ClauseForSummary[],
  contractType: string,
  language: string,
): Promise<Omit<Summary, "clauseBreakdown">> {
  const client = getAnthropicClient();
  let lastError: unknown;

  logger.info("Summary starting", { clauseCount: analyses.length, contractType, language });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) logger.info("Summary retry", { attempt: attempt + 1 });
      const response = await client.messages.create({
        model: MODELS.sonnet,
        max_tokens: 1024,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildSummaryUserMessage(analyses, contractType, language),
          },
        ],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in Claude response");
      }

      const parsed = JSON.parse(stripCodeFences(textBlock.text)) as unknown;
      const result = SummaryResponseSchema.parse(parsed);
      logger.info("Summary complete", {
        overallRiskScore: result.overallRiskScore,
        recommendation: result.recommendation,
        concernCount: result.topConcerns.length,
      });
      return result;
    } catch (error) {
      logger.error("Summary attempt failed", {
        step: "summary",
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
        retried: attempt === 0,
      });
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Summary agent failed after 2 attempts: ${message}`);
}
