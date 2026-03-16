import type Anthropic from "@anthropic-ai/sdk";
import {
  type ClauseAnalysis,
  type KnowledgePattern,
  logger,
  type PositionedClause,
  RecommendationSchema,
  RiskLevelSchema,
  type SSEEvent,
  type Summary,
} from "@redflag/shared";
import { z } from "zod";
import { getAnthropicClient, MODELS } from "./client";
import { formatPatternsForPrompt } from "./format-patterns";
import { buildCombinedSystemPrompt, buildCombinedUserMessage } from "./prompts/combined-analysis";

// ── Tool Definitions ──────────────────────────────────────────────

const REPORT_CLAUSE_TOOL: Anthropic.Messages.Tool = {
  name: "report_clause",
  description: "Report risk analysis for a single contract clause",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      position: {
        type: "integer",
        description: "Zero-based clause position from the [N] label in the input",
      },
      riskLevel: {
        type: "string",
        enum: ["red", "yellow", "green"],
        description: "Risk assessment level",
      },
      explanation: {
        type: "string",
        description: "Plain-language risk explanation in document language",
      },
      category: {
        type: "string",
        description: "Risk category (e.g. termination, liability, rent)",
      },
      saferAlternative: {
        type: "string",
        description: "Fairer rewrite of the clause for red/yellow. Empty string for green.",
      },
    },
    required: ["position", "riskLevel", "explanation", "category", "saferAlternative"],
    additionalProperties: false,
  },
};

const REPORT_SUMMARY_TOOL: Anthropic.Messages.Tool = {
  name: "report_summary",
  description: "Report overall contract risk summary after analyzing all clauses",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      overallRiskScore: {
        type: "integer",
        description: "Overall risk score 0-100",
      },
      recommendation: {
        type: "string",
        enum: ["sign", "caution", "do_not_sign"],
        description: "Recommendation based on risk score",
      },
      topConcerns: {
        type: "array",
        items: { type: "string" },
        description: "Top 3-5 concerns ordered by severity",
      },
    },
    required: ["overallRiskScore", "recommendation", "topConcerns"],
    additionalProperties: false,
  },
};

/** Exported for test assertions */
export const TOOL_DEFINITIONS = [REPORT_CLAUSE_TOOL, REPORT_SUMMARY_TOOL];

// ── Internal Zod Schemas (defense-in-depth alongside strict: true) ─

const ReportClauseInputSchema = z.object({
  position: z.number().int().nonnegative(),
  riskLevel: RiskLevelSchema,
  explanation: z.string(),
  category: z.string(),
  saferAlternative: z.string(),
});

const ReportSummaryInputSchema = z.object({
  overallRiskScore: z.number().int().min(0).max(100),
  recommendation: RecommendationSchema,
  topConcerns: z.array(z.string()),
});

// ── Public Interface ──────────────────────────────────────────────

export interface CombinedAnalysisParams {
  clauses: PositionedClause[];
  contractType: string;
  language: string;
  responseLanguage: string;
  ragPatterns: KnowledgePattern[];
}

/**
 * Estimate max output tokens based on clause count.
 * ~300 tokens per clause average: green clauses use ~50 tokens (brief explanation),
 * red/yellow use ~600 tokens (concise explanation + rewrite).
 * + 4096 buffer for summary + inter-tool text.
 * Cap at 64000 (Sonnet 4.6 max output tokens).
 */
function estimateMaxTokens(clauseCount: number): number {
  return Math.min(clauseCount * 300 + 4096, 64000);
}

/**
 * Analyze all clauses in a single streaming Claude call using tool_use.
 *
 * Yields `clause_analysis` events as each `report_clause` tool call completes,
 * and a `summary` event when `report_summary` completes.
 *
 * Retries once on API failure (2-attempt pattern matching existing agents).
 */
export async function* analyzeAllClauses(params: CombinedAnalysisParams): AsyncGenerator<SSEEvent> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        logger.info("Combined analysis retry", { attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, 2000));
      }
      yield* analyzeAllClausesInternal(params);
      return;
    } catch (error) {
      lastError = error;
      logger.error("Combined analysis attempt failed", {
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  logger.error("Combined analysis failed after 2 attempts", { error: message });
  yield {
    type: "error",
    message: "Analysis temporarily unavailable. Please try again in a few minutes.",
    recoverable: true,
  };
}

// ── Internal Streaming Logic ──────────────────────────────────────

async function* analyzeAllClausesInternal(
  params: CombinedAnalysisParams,
): AsyncGenerator<SSEEvent> {
  const client = getAnthropicClient();
  const clauseMap = new Map(params.clauses.map((c) => [c.position, c]));

  logger.info("Combined analysis starting", {
    clauseCount: params.clauses.length,
    contractType: params.contractType,
    language: params.language,
    responseLanguage: params.responseLanguage,
    ragPatternCount: params.ragPatterns.length,
  });

  const stream = client.messages.stream({
    model: MODELS.sonnet,
    max_tokens: estimateMaxTokens(params.clauses.length),
    system: buildCombinedSystemPrompt(
      formatPatternsForPrompt(params.ragPatterns),
      params.contractType,
      params.language,
      params.responseLanguage,
    ),
    messages: [
      {
        role: "user",
        content: buildCombinedUserMessage(params.clauses),
      },
    ],
    tools: TOOL_DEFINITIONS,
    tool_choice: { type: "auto" },
  });

  // Track active tool calls by content block index
  const activeTools = new Map<number, { name: string; jsonBuf: string }>();
  const analyzedPositions = new Set<number>();
  const clauseRiskLevels: string[] = [];
  let stopReason: string | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "tool_use") {
          activeTools.set(event.index, {
            name: event.content_block.name,
            jsonBuf: "",
          });
        }
        break;
      }

      case "content_block_delta": {
        if (event.delta.type === "input_json_delta") {
          const tool = activeTools.get(event.index);
          if (tool) {
            tool.jsonBuf += event.delta.partial_json;
          }
        }
        break;
      }

      case "content_block_stop": {
        const tool = activeTools.get(event.index);
        if (!tool) break;
        activeTools.delete(event.index);

        if (tool.name === "report_clause") {
          yield* handleReportClause(tool.jsonBuf, clauseMap, analyzedPositions, clauseRiskLevels);
        } else if (tool.name === "report_summary") {
          yield* handleReportSummary(
            tool.jsonBuf,
            clauseRiskLevels,
            params.contractType,
            params.language,
          );
        }
        break;
      }

      case "message_delta": {
        stopReason = event.delta.stop_reason;
        break;
      }
    }
  }

  // Post-stream checks
  const missingPositions = params.clauses
    .filter((c) => !analyzedPositions.has(c.position))
    .map((c) => c.position);

  if (stopReason === "max_tokens" && missingPositions.length > 0) {
    logger.warn("Analysis truncated by max_tokens", { missingPositions });
    yield {
      type: "error",
      message: `Analysis was cut short. ${missingPositions.length} clause(s) could not be analyzed.`,
      recoverable: true,
    };
  } else if (missingPositions.length > 0) {
    logger.warn("Claude skipped clause positions", { missingPositions });
  }

  logger.info("Combined analysis complete", {
    analyzedCount: analyzedPositions.size,
    totalCount: params.clauses.length,
    stopReason,
  });
}

// ── Tool Call Handlers ────────────────────────────────────────────

function* handleReportClause(
  jsonBuf: string,
  clauseMap: Map<number, PositionedClause>,
  analyzedPositions: Set<number>,
  clauseRiskLevels: string[],
): Generator<SSEEvent> {
  let input: z.infer<typeof ReportClauseInputSchema>;
  try {
    const parsed = JSON.parse(jsonBuf) as unknown;
    input = ReportClauseInputSchema.parse(parsed);
  } catch (error) {
    logger.error("Failed to parse report_clause input", {
      error: error instanceof Error ? error.message : String(error),
      jsonBuf: jsonBuf.slice(0, 200),
    });
    return;
  }

  const clause = clauseMap.get(input.position);
  if (!clause) {
    logger.warn("Invalid clause position from Claude", {
      position: input.position,
      validPositions: [...clauseMap.keys()],
    });
    return;
  }

  analyzedPositions.add(input.position);
  clauseRiskLevels.push(input.riskLevel);

  const analysis: ClauseAnalysis = {
    clauseText: clause.text,
    startIndex: Math.max(0, clause.startIndex),
    endIndex: Math.max(1, clause.endIndex),
    position: clause.position,
    riskLevel: input.riskLevel,
    explanation: input.explanation,
    category: input.category,
    saferAlternative: input.saferAlternative === "" ? null : input.saferAlternative,
    matchedPatterns: [], // enriched later by orchestrator via computeMatchedPatterns
  };

  logger.info("Clause analyzed", {
    position: clause.position,
    riskLevel: input.riskLevel,
    category: input.category,
  });

  yield { type: "clause_analysis", data: analysis };
}

function* handleReportSummary(
  jsonBuf: string,
  clauseRiskLevels: string[],
  contractType: string,
  language: string,
): Generator<SSEEvent> {
  let input: z.infer<typeof ReportSummaryInputSchema>;
  try {
    const parsed = JSON.parse(jsonBuf) as unknown;
    input = ReportSummaryInputSchema.parse(parsed);
  } catch (error) {
    logger.error("Failed to parse report_summary input", {
      error: error instanceof Error ? error.message : String(error),
      jsonBuf: jsonBuf.slice(0, 200),
    });
    return;
  }

  const clauseBreakdown = {
    red: clauseRiskLevels.filter((r) => r === "red").length,
    yellow: clauseRiskLevels.filter((r) => r === "yellow").length,
    green: clauseRiskLevels.filter((r) => r === "green").length,
  };

  const summary: Summary = {
    overallRiskScore: input.overallRiskScore,
    recommendation: input.recommendation,
    topConcerns: input.topConcerns,
    clauseBreakdown,
    language,
    contractType,
  };

  logger.info("Summary generated", {
    overallRiskScore: input.overallRiskScore,
    recommendation: input.recommendation,
    concernCount: input.topConcerns.length,
    clauseBreakdown,
  });

  yield { type: "summary", data: summary };
}
