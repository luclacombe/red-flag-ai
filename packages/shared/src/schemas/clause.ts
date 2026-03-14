import { z } from "zod";
import { RiskLevelSchema } from "./enums.js";

export const ClauseAnalysisSchema = z.object({
  clauseText: z.string(),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  riskLevel: RiskLevelSchema,
  explanation: z.string(),
  saferAlternative: z.string().nullable(),
  category: z.string(),
  matchedPatterns: z.array(z.string()),
});

export type ClauseAnalysis = z.infer<typeof ClauseAnalysisSchema>;
