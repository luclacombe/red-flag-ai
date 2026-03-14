import { z } from "zod";
import { RecommendationSchema } from "./enums";

export const ClauseBreakdownSchema = z.object({
  red: z.number().int().nonnegative(),
  yellow: z.number().int().nonnegative(),
  green: z.number().int().nonnegative(),
});

export const SummarySchema = z.object({
  overallRiskScore: z.number().int().min(0).max(100),
  recommendation: RecommendationSchema,
  topConcerns: z.array(z.string()),
  clauseBreakdown: ClauseBreakdownSchema,
  language: z.string(),
  contractType: z.string(),
});

export type Summary = z.infer<typeof SummarySchema>;
