import { logger, type ParsedClause } from "@redflag/shared";
import { detectClauseBoundaries } from "./boundary-detect";
import { parseClausesHeuristic } from "./heuristic-parse";

/**
 * Check if a heuristic parse result is suspicious — too few clauses for the document size.
 *
 * Suspicious conditions (trigger LLM fallback):
 * - 1 clause AND document > 500 characters
 * - 2 clauses AND document > 2000 characters
 * - Any result where the largest clause is > 80% of total document text
 */
export function isSuspiciousResult(clauses: ParsedClause[], textLength: number): boolean {
  if (clauses.length === 0) return false; // handled separately as "no clauses"

  // Short documents are likely simple agreements — accept any parse result
  if (textLength <= 500) return false;

  if (clauses.length === 1) return true;
  if (clauses.length === 2 && textLength > 2000) return true;

  // Check if one clause dominates (only meaningful for larger documents with 3+ clauses)
  const maxClauseLen = Math.max(...clauses.map((c) => c.text.length));
  if (maxClauseLen > textLength * 0.8) return true;

  return false;
}

/**
 * Smart parse — heuristic first, Haiku LLM fallback if result is suspicious.
 *
 * 1. Run heuristic parser (instant, free)
 * 2. Check if result is suspicious (too few clauses for document size)
 * 3. If suspicious, call Haiku boundary detection (~1-3s, ~$0.001)
 * 4. If fallback fails, return heuristic result as-is (graceful degradation)
 *
 * Returns same `ParsedClause[]` shape — downstream pipeline works unchanged.
 */
export async function parseClausesSmart(
  text: string,
  contractType: string,
  language: string,
): Promise<ParsedClause[]> {
  // Step 1: Heuristic parse (instant, synchronous)
  const heuristicResult = parseClausesHeuristic(text, contractType, language);

  // Step 2: Check if the result is suspicious
  if (!isSuspiciousResult(heuristicResult, text.length)) {
    logger.info("Smart parse: heuristic result accepted", {
      clauseCount: heuristicResult.length,
      path: "heuristic",
    });
    return heuristicResult;
  }

  // Step 3: Heuristic result is suspicious — try LLM fallback
  logger.warn("Smart parse: heuristic result suspicious, falling back to LLM boundary detection", {
    heuristicClauseCount: heuristicResult.length,
    textLength: text.length,
  });

  try {
    const llmResult = await detectClauseBoundaries(text, contractType, language);
    logger.info("Smart parse: LLM fallback succeeded", {
      clauseCount: llmResult.length,
      path: "llm_fallback",
    });
    return llmResult;
  } catch (error) {
    // Step 4: Fallback failed — return heuristic result as-is (better than nothing)
    logger.error("Smart parse: LLM fallback failed, using heuristic result", {
      error: error instanceof Error ? error.message : String(error),
      heuristicClauseCount: heuristicResult.length,
      path: "heuristic_degraded",
    });
    return heuristicResult;
  }
}
