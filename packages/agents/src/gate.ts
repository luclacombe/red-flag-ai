import { type GateResult, GateResultSchema, logger } from "@redflag/shared";
import { getAnthropicClient, MODELS, stripCodeFences } from "./client";
import { buildGateUserMessage, GATE_SYSTEM_PROMPT } from "./prompts/gate";

/** Max chars of extracted text to send to the gate agent */
const GATE_TEXT_LIMIT = 2000;

/**
 * Relevance gate — classifies whether extracted text is a legal contract.
 * Uses Claude Haiku for fast, cheap classification.
 *
 * @param text - Full extracted text from the PDF
 * @returns GateResult with classification details
 * @throws Error if both attempts fail
 */
export async function relevanceGate(text: string): Promise<GateResult> {
  const truncated = text.slice(0, GATE_TEXT_LIMIT);
  const client = getAnthropicClient();

  logger.info("Gate starting", { textLen: truncated.length });
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) logger.info("Gate retry", { attempt: attempt + 1 });
      const response = await client.messages.create({
        model: MODELS.haiku,
        max_tokens: 256,
        system: GATE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildGateUserMessage(truncated) }],
      });

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in Claude response");
      }

      const parsed = JSON.parse(stripCodeFences(textBlock.text)) as unknown;
      const result = GateResultSchema.parse(parsed);
      logger.info("Gate result", {
        isContract: result.isContract,
        contractType: result.contractType,
        language: result.language,
      });
      return result;
    } catch (error) {
      logger.error("Gate attempt failed", {
        step: "gate",
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
        retried: attempt === 0,
      });
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Relevance gate failed after 2 attempts: ${message}`);
}
