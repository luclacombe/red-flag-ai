export { detectClauseBoundaries, findAnchorPosition, splitAtAnchors } from "./boundary-detect";
export { getAnthropicClient, MODELS, stripCodeFences } from "./client";
export {
  analyzeAllClauses,
  type CombinedAnalysisParams,
  TOOL_DEFINITIONS,
} from "./combined-analysis";
export { computeMatchedPatterns } from "./compute-matched-patterns";
export { findTopMatchesInMemory, formatPatternsForPrompt } from "./format-patterns";
export { relevanceGate } from "./gate";
export { parseClausesHeuristic } from "./heuristic-parse";
export {
  type AnalyzeContractParams,
  analyzeContract,
  computeClausePositions,
} from "./orchestrator";
export { isSuspiciousResult, parseClausesSmart } from "./smart-parse";
export { summarize } from "./summary";
