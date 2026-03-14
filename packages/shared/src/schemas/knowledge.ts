import { z } from "zod";
import { KnowledgeRiskLevelSchema } from "./enums.js";

export const KnowledgePatternSchema = z.object({
  id: z.string().uuid(),
  clausePattern: z.string(),
  category: z.string(),
  contractType: z.array(z.string()),
  riskLevel: KnowledgeRiskLevelSchema,
  whyRisky: z.string(),
  saferAlternative: z.string(),
  jurisdictionNotes: z.string(),
});

export type KnowledgePattern = z.infer<typeof KnowledgePatternSchema>;
