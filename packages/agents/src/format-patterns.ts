import type { KnowledgePatternWithEmbedding } from "@redflag/db";
import type { KnowledgePattern } from "@redflag/shared";

/** Minimum cosine similarity to consider a pattern as matched */
const PATTERN_MATCH_THRESHOLD = 0.7;

/**
 * Format knowledge base patterns into a structured text block for injection
 * into a Claude system prompt. Groups patterns by category for readability.
 *
 * Target: ~50-200 tokens per pattern, ~2K-8K tokens total for a contract type.
 */
export function formatPatternsForPrompt(patterns: KnowledgePattern[]): string {
  if (patterns.length === 0) {
    return "No specific risk patterns available for this contract type.";
  }

  // Group by category
  const grouped = new Map<string, KnowledgePattern[]>();
  for (const pattern of patterns) {
    const existing = grouped.get(pattern.category) ?? [];
    existing.push(pattern);
    grouped.set(pattern.category, existing);
  }

  const sections: string[] = [];

  for (const [category, categoryPatterns] of grouped) {
    const heading = `### ${formatCategory(category)}`;
    const items = categoryPatterns.map(
      (p) =>
        `- [${p.riskLevel.toUpperCase()}] ${p.clausePattern}\n  Why: ${p.whyRisky}\n  Safer: ${p.saferAlternative}`,
    );
    sections.push(`${heading}\n${items.join("\n")}`);
  }

  return `## Known Risk Patterns\n\n${sections.join("\n\n")}`;
}

/**
 * Compute cosine similarity between a clause embedding and all pattern embeddings.
 * Returns pattern IDs above the similarity threshold, sorted by similarity descending.
 *
 * Pure TypeScript — no DB or API calls. Used to populate `matchedPatterns` on each clause.
 */
export function findTopMatchesInMemory(
  _clauseText: string,
  clauseEmbedding: number[],
  patterns: KnowledgePatternWithEmbedding[],
  topK: number,
): { patternId: string; similarity: number }[] {
  if (clauseEmbedding.length === 0 || patterns.length === 0) {
    return [];
  }

  const results: { patternId: string; similarity: number }[] = [];

  for (const pattern of patterns) {
    if (pattern.embedding.length !== clauseEmbedding.length) continue;
    const similarity = cosineSimilarity(clauseEmbedding, pattern.embedding);
    if (similarity >= PATTERN_MATCH_THRESHOLD) {
      results.push({ patternId: pattern.id, similarity });
    }
  }

  // Sort by similarity descending, take top K
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * Cosine similarity: dot(a,b) / (|a| * |b|).
 * Returns value in [-1, 1] where 1 = identical direction.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/** Format a snake_case category into Title Case */
function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
