import { logger, RecommendationSchema, type Summary, type TokenUsage } from "@redflag/shared";
import { z } from "zod";
import { getAnthropicClient, MODELS, stripCodeFences } from "./client";
import { buildSummaryUserMessage, SUMMARY_SYSTEM_PROMPT } from "./prompts/summary";

// What Claude returns — no clauseBreakdown (computed by orchestrator); language and
// contractType are already known, so they are set in code instead of echoed by the model
const SummaryResponseSchema = z.object({
  overallRiskScore: z.number().int().min(0).max(100),
  recommendation: RecommendationSchema,
  topConcerns: z.array(z.string()),
});

/** Structured output schema (0-100 range enforced by Zod; JSON Schema min/max is unsupported) */
const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    overallRiskScore: { type: "integer" },
    recommendation: { type: "string", enum: ["sign", "caution", "do_not_sign"] },
    topConcerns: { type: "array", items: { type: "string" } },
  },
  required: ["overallRiskScore", "recommendation", "topConcerns"],
  additionalProperties: false,
};

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
 * @param documentLanguage - Document language code
 * @param responseLanguage - User-selected output language for explanations/concerns
 * @returns Summary without clauseBreakdown (orchestrator computes it deterministically)
 * @throws Error if both attempts fail
 */
export async function summarize(
  analyses: ClauseForSummary[],
  contractType: string,
  documentLanguage: string,
  responseLanguage: string,
  onUsage?: (usage: TokenUsage) => void,
): Promise<Omit<Summary, "clauseBreakdown">> {
  const client = getAnthropicClient();
  let lastError: unknown;

  const language = documentLanguage;
  logger.info("Summary starting", {
    clauseCount: analyses.length,
    contractType,
    language,
    responseLanguage,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) logger.info("Summary retry", { attempt: attempt + 1 });
      const response = await client.messages.create({
        model: MODELS.sonnet,
        // Headroom: 5.5 models can think before replying and thinking counts toward max_tokens
        max_tokens: 4096,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: SUMMARY_OUTPUT_SCHEMA },
        },
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildSummaryUserMessage(analyses, contractType, language, responseLanguage),
          },
        ],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error(
          `No text content in Claude response (stop_reason: ${response.stop_reason})`,
        );
      }

      const parsed = JSON.parse(stripCodeFences(textBlock.text)) as unknown;
      const result = SummaryResponseSchema.parse(parsed);
      onUsage?.({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
      logger.info("Summary complete", {
        overallRiskScore: result.overallRiskScore,
        recommendation: result.recommendation,
        concernCount: result.topConcerns.length,
      });
      return { ...result, language, contractType };
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
