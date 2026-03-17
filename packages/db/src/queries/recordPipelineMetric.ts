import type { PipelineStep, TokenUsage } from "@redflag/shared";
import { getDb } from "../client";
import { pipelineMetrics } from "../schema";

export interface PipelineMetricInput {
  analysisId?: string;
  step: PipelineStep;
  durationMs: number;
  usage?: TokenUsage;
  model?: string;
  success: boolean;
  errorMessage?: string;
}

export async function recordPipelineMetric(input: PipelineMetricInput): Promise<void> {
  const db = getDb();
  await db.insert(pipelineMetrics).values({
    analysisId: input.analysisId ?? null,
    step: input.step,
    durationMs: input.durationMs,
    inputTokens: input.usage?.inputTokens ?? null,
    outputTokens: input.usage?.outputTokens ?? null,
    model: input.model ?? null,
    success: input.success,
    errorMessage: input.errorMessage ?? null,
  });
}
