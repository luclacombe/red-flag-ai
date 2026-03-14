import { type GateResult, GateResultSchema } from "@redflag/shared";
import { getAnthropicClient, MODELS } from "./client";
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

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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

      const parsed = JSON.parse(textBlock.text) as unknown;
      const result = GateResultSchema.parse(parsed);
      return result;
    } catch (error) {
      lastError = error;
      // Retry once on any error (API error or malformed response)
      if (attempt === 0) continue;
    }
  }

  // Both attempts failed — return a clear rejection
  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Relevance gate failed after 2 attempts: ${message}`);
}
