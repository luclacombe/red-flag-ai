export { eq, sql } from "drizzle-orm";
export { db, getDb } from "./client";
export { embedText, embedTexts } from "./embeddings";
export {
  type FindSimilarPatternsOptions,
  findSimilarPatterns,
  type SimilarPattern,
} from "./queries/findSimilarPatterns";
export * from "./schema";
