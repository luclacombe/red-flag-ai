export { getAnthropicClient, MODELS, stripCodeFences } from "./client";
export { computeMatchedPatterns } from "./compute-matched-patterns";
export { findTopMatchesInMemory, formatPatternsForPrompt } from "./format-patterns";
export { relevanceGate } from "./gate";
export { parseClausesHeuristic } from "./heuristic-parse";
export {
  type AnalyzeContractParams,
  analyzeContract,
  computeClausePositions,
} from "./orchestrator";
export { parseClauses } from "./parse";
export { rewriteClause } from "./rewrite";
export { analyzeClause, type RiskAnalysisResult } from "./risk";
export { summarize } from "./summary";
