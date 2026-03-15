import type { KnowledgePattern } from "@redflag/shared";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

export interface KnowledgePatternWithEmbedding extends KnowledgePattern {
  embedding: number[];
}

/**
 * Fetch all knowledge patterns for a given contract type in a single query.
 * Returns patterns including their embedding vectors (for in-memory similarity).
 *
 * Replaces per-clause `findSimilarPatterns()` + Voyage embedding for the new pipeline.
 * Typically returns ~20-50 patterns from the ~100-200 total in the knowledge base.
 */
export async function getPatternsByContractType(
  contractType: string,
): Promise<KnowledgePatternWithEmbedding[]> {
  const db = getDb();

  const rows = await db.execute(sql`
		SELECT id, clause_pattern, category, contract_type, risk_level,
		       why_risky, safer_alternative, jurisdiction_notes, embedding
		FROM knowledge_patterns
		WHERE contract_type @> ${JSON.stringify([contractType])}::jsonb
		ORDER BY category, risk_level DESC
	`);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    clausePattern: row.clause_pattern as string,
    category: row.category as string,
    contractType: row.contract_type as string[],
    riskLevel: row.risk_level as "red" | "yellow",
    whyRisky: row.why_risky as string,
    saferAlternative: row.safer_alternative as string,
    jurisdictionNotes: row.jurisdiction_notes as string,
    embedding: parseEmbedding(row.embedding),
  }));
}

/**
 * Parse a pgvector embedding value into a number array.
 * pgvector returns vectors as string "[0.1,0.2,...]" in raw SQL results.
 */
function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    return JSON.parse(value) as number[];
  }
  return [];
}
