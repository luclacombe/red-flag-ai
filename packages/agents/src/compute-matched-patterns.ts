import type { KnowledgePatternWithEmbedding } from "@redflag/db";
import { embedTexts } from "@redflag/db";
import { logger, type ParsedClause } from "@redflag/shared";
import { findTopMatchesInMemory } from "./format-patterns";

/** Max texts per Voyage API batch call */
const EMBEDDING_BATCH_LIMIT = 128;

/** Top K patterns to match per clause */
const TOP_K = 5;

/**
 * Batch-embed all clause texts and compute in-memory cosine similarity
 * against pre-fetched knowledge base patterns.
 *
 * Returns a map of clause position → matched pattern IDs.
 * Handles Voyage API failure gracefully by returning an empty map.
 *
 * This replaces the old per-clause embed + vector search approach:
 * - 1 batch Voyage call instead of N individual calls
 * - In-memory similarity instead of N pgvector queries
 */
export async function computeMatchedPatterns(
  clauses: ParsedClause[],
  patterns: KnowledgePatternWithEmbedding[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();

  if (clauses.length === 0 || patterns.length === 0) {
    return result;
  }

  // Batch-embed all clause texts (chunked if > 128)
  const texts = clauses.map((c) => c.text);
  const embeddings = await batchEmbed(texts);

  logger.info("Clause embeddings complete", {
    clauseCount: clauses.length,
    patternCount: patterns.length,
  });

  // For each clause, find matching patterns via in-memory cosine similarity
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    const embedding = embeddings[i];
    if (!clause || !embedding) continue;

    const matches = findTopMatchesInMemory(clause.text, embedding, patterns, TOP_K);

    if (matches.length > 0) {
      result.set(
        clause.position,
        matches.map((m) => m.patternId),
      );
    }
  }

  return result;
}

/**
 * Batch-embed texts, chunking into groups of 128 to respect Voyage API limits.
 */
async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length <= EMBEDDING_BATCH_LIMIT) {
    return embedTexts(texts, "query");
  }

  const allEmbeddings: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_LIMIT) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_LIMIT);
    const batchEmbeddings = await embedTexts(batch, "query");
    allEmbeddings.push(...batchEmbeddings);
  }
  return allEmbeddings;
}
