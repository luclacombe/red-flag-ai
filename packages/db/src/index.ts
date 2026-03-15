export { eq, sql } from "drizzle-orm";
export { db, getDb } from "./client";
export { embedText, embedTexts } from "./embeddings";
export {
  type FindSimilarPatternsOptions,
  findSimilarPatterns,
  type SimilarPattern,
} from "./queries/findSimilarPatterns";
export {
  getPatternsByContractType,
  type KnowledgePatternWithEmbedding,
} from "./queries/getPatternsByContractType";
export * from "./schema";
