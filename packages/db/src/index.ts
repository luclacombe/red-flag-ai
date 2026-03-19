export { and, desc, eq, gte, sql } from "drizzle-orm";
export { db, getDb } from "./client";
export { embedText, embedTexts } from "./embeddings";
export {
  getPatternsByContractType,
  type KnowledgePatternWithEmbedding,
} from "./queries/getPatternsByContractType";
export {
  type PipelineMetricInput,
  recordPipelineMetric,
} from "./queries/recordPipelineMetric";
export * from "./schema";
