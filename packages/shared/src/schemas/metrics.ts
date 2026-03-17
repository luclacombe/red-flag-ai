export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export const PIPELINE_STEPS = ["gate", "parse", "combined_analysis", "summary_fallback"] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
