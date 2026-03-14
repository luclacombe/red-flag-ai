import { z } from "zod";

export const RiskLevelSchema = z.enum(["red", "yellow", "green"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const KnowledgeRiskLevelSchema = z.enum(["red", "yellow"]);
export type KnowledgeRiskLevel = z.infer<typeof KnowledgeRiskLevelSchema>;

export const RecommendationSchema = z.enum(["sign", "caution", "do_not_sign"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const AnalysisStatusSchema = z.enum(["pending", "processing", "complete", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;
