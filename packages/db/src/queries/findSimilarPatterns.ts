import type { KnowledgePattern } from "@redflag/shared";
import { sql } from "drizzle-orm";
import { getDb } from "../client";
import { knowledgePatterns } from "../schema";

export interface SimilarPattern extends KnowledgePattern {
  similarity: number;
}

export interface FindSimilarPatternsOptions {
  /** Maximum number of results. Default: 5 */
  topK?: number;
  /** Filter by contract type (e.g. "lease", "nda") */
  contractType?: string;
}

/**
 * Find knowledge base patterns most similar to the given embedding
 * using pgvector cosine distance search.
 *
 * @param embedding - 1024-dimensional query embedding
 * @param options - Optional topK limit and contract type filter
 * @returns Patterns ordered by similarity (highest first), with similarity score
 */
export async function findSimilarPatterns(
  embedding: number[],
  options?: FindSimilarPatternsOptions,
): Promise<SimilarPattern[]> {
  const db = getDb();
  const topK = options?.topK ?? 5;
  const contractType = options?.contractType;

  const vectorLiteral = `[${embedding.join(",")}]`;

  // Cosine distance: <=> returns distance (0 = identical, 2 = opposite)
  // Similarity = 1 - distance
  const query = contractType
    ? sql`
        SELECT
          id, clause_pattern, category, contract_type, risk_level,
          why_risky, safer_alternative, jurisdiction_notes,
          1 - (${knowledgePatterns.embedding} <=> ${vectorLiteral}::vector) AS similarity
        FROM knowledge_patterns
        WHERE contract_type @> ${JSON.stringify([contractType])}::jsonb
        ORDER BY ${knowledgePatterns.embedding} <=> ${vectorLiteral}::vector ASC
        LIMIT ${topK}
      `
    : sql`
        SELECT
          id, clause_pattern, category, contract_type, risk_level,
          why_risky, safer_alternative, jurisdiction_notes,
          1 - (${knowledgePatterns.embedding} <=> ${vectorLiteral}::vector) AS similarity
        FROM knowledge_patterns
        ORDER BY ${knowledgePatterns.embedding} <=> ${vectorLiteral}::vector ASC
        LIMIT ${topK}
      `;

  const rows = await db.execute(query);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    clausePattern: row.clause_pattern as string,
    category: row.category as string,
    contractType: row.contract_type as string[],
    riskLevel: row.risk_level as "red" | "yellow",
    whyRisky: row.why_risky as string,
    saferAlternative: row.safer_alternative as string,
    jurisdictionNotes: row.jurisdiction_notes as string,
    similarity: Number(row.similarity),
  }));
}
