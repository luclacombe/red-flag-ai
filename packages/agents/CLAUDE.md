# @redflag/agents

Agent pipeline — pure async functions for each step of contract analysis.

## What's Here

- `src/client.ts` — Shared Anthropic client factory (`getAnthropicClient()`) + model ID constants (`MODELS.haiku`, `MODELS.sonnet`)
- `src/gate.ts` — Relevance gate agent (`relevanceGate(text)` → `GateResult`). Uses Haiku, retries once on failure.
- `src/heuristic-parse.ts` — Heuristic clause splitter (`parseClausesHeuristic(text, contractType, language)` → `ParsedClause[]`). Regex-based, runs in <10ms.
- `src/boundary-detect.ts` — **Anchor-based** clause boundary detection (`detectClauseBoundaries(text, contractType, language)` → `ParsedClause[]`). Uses Haiku with `strict: true` tool_use. Haiku returns the first ~10 words of each clause copied verbatim; `splitAtAnchors()` finds them via `indexOf()` with whitespace-normalized fallback. Works regardless of PDF line structure. Also exports `findAnchorPosition()` and `splitAtAnchors()`.
- `src/smart-parse.ts` — Hybrid parse wrapper (`parseClausesSmart(text, contractType, language)` → `Promise<ParsedClause[]>`). Runs heuristic parser first; if result is suspicious (too few clauses for document size), falls back to Haiku boundary detection. Also exports `isSuspiciousResult()` for testing.
- `src/prompts/boundary-detect.ts` — System prompt + user message builder for Haiku anchor-based boundary detection. Raw document text (no line numbering), untrusted input framing.
- `src/combined-analysis.ts` — Single streaming Claude call with `report_clause` + `report_summary` tools. `analyzeAllClauses(params)` → async generator yielding `SSEEvent`. Uses `strict: true` (guaranteed valid JSON) and `eager_input_streaming: true` (fine-grained streaming).
- `src/prompts/combined-analysis.ts` — Combined system prompt + user message builder for the streaming analysis call. Merges risk analysis + rewrite + summary instructions. RAG patterns injected into system prompt. Accepts separate `documentLanguage` and `responseLanguage` params — explanations in responseLanguage, saferAlternative in documentLanguage.
- `src/format-patterns.ts` — RAG pattern formatting (`formatPatternsForPrompt(patterns)` → `string`) and in-memory cosine similarity (`findTopMatchesInMemory(clauseText, embedding, patterns, topK)` → `{ patternId, similarity }[]`).
- `src/compute-matched-patterns.ts` — Batch embed + in-memory similarity (`computeMatchedPatterns(clauses, patterns)` → `Map<number, string[]>`). One Voyage call for all clauses, then cosine similarity against pre-fetched patterns.
- `src/summary.ts` — Summary agent (`summarize(analyses, contractType, language)` → `Omit<Summary, "clauseBreakdown">`). Used as fallback when `report_summary` tool is not called by the combined analysis.
- `src/orchestrator.ts` — Pipeline orchestrator (`analyzeContract(params)` async generator → `SSEEvent`). Chains smart parse (hybrid heuristic + LLM) → bulk RAG → combined streaming analysis → summary fallback. Also exports `computeClausePositions()`. `AnalyzeContractParams` includes `fileType: FileType` — threaded into `document_text` event for frontend viewer dispatch. `clause_positions` event sends full `PositionedClause[]` (with `startIndex`/`endIndex`). Records `pipeline_metrics` for each step (parse, combined_analysis, summary_fallback) via `recordPipelineMetric()` fire-and-forget.
- `src/prompts/` — System prompts + user message builders (gate, boundary-detect, combined-analysis, summary)
- `src/__tests__/` — Unit tests for all agents, orchestrator, heuristic parser, boundary detection, smart parse, combined analysis, pattern formatting, matched patterns
- `src/__tests__/fixtures/generate-pdf.ts` — Minimal valid PDF generator for tests (no deps)

## Pipeline

```
Gate → Smart Parse (heuristic + optional Haiku fallback) → Bulk RAG → Combined Analysis (streaming) → [Summary fallback]
```

Total API calls: 3-4 (gate + optional Haiku boundary detection + combined analysis + optional summary fallback)

## Dependencies

- `@anthropic-ai/sdk` — Claude API client (streaming, tool_use with `strict: true`)
- `@redflag/shared` — Zod schemas, types (`ParsedClause`, `PositionedClause`, `ClauseAnalysis`, `Summary`, `SSEEvent`, etc.)
- `@redflag/db` — Database client, schema tables, embedding functions, `getPatternsByContractType()`, `KnowledgePatternWithEmbedding`, Drizzle operators (`eq`, `sql`)
- `zod` — Internal agent response validation schemas
- `unpdf` (dev only) — PDF text extraction for tests

## Key Design Details

- **Combined streaming analysis**: A single `client.messages.stream()` call with `report_clause` and `report_summary` tool definitions. Claude calls `report_clause` once per clause and `report_summary` at the end. Each tool call streams via `eager_input_streaming` and is processed at `content_block_stop`. `strict: true` guarantees valid JSON — zero parse errors. Green clause explanations are kept brief (1 sentence, max 15 words) to reduce output tokens while preserving per-clause analysis quality.
- **Tool definitions**: `report_clause` (position, riskLevel, explanation, category, saferAlternative) and `report_summary` (overallRiskScore, recommendation, topConcerns). Both use `strict: true` and `eager_input_streaming: true`. Exported as `TOOL_DEFINITIONS` for test assertions.
- **Position referencing**: Clauses are listed in the user message with their original position numbers (`[0]`, `[3]`, `[7]`). Claude references by position in tool calls. The handler maps position back to the original `PositionedClause` via a `Map<number, PositionedClause>`. This avoids copying clause text in output (saves ~50% output tokens).
- **saferAlternative normalization**: Tool schema requires string (not nullable). Claude returns `""` for green clauses. Handler converts `""` → `null` to match `ClauseAnalysis` type.
- **Heuristic parser**: Regex-based structural detection. Priority: dotted decimal → article keywords (multilingual) → ALL-CAPS headings → roman numerals → parenthetical → paragraph fallback. Runs in <1ms.
- **Smart parse (hybrid)** (Phase 1b): `parseClausesSmart()` wraps the heuristic parser. If the result is suspicious (1 clause and doc >500 chars, 2 clauses and doc >2000 chars, or largest clause >80% of doc), falls back to Haiku LLM boundary detection. If Haiku fails, returns heuristic result as-is (graceful degradation). Short documents (<=500 chars) always accept heuristic result.
- **Haiku boundary detection (anchor-based)**: Sends raw document text to Haiku with a `report_boundaries` tool (`strict: true`, `tool_choice: { type: "tool" }`). Haiku returns the first ~10 words of each clause copied verbatim (~100-200 tokens output). `splitAtAnchors()` finds each anchor via `indexOf()` with whitespace-normalized fallback (`buildNormalizedMap` for position mapping). Works regardless of PDF line structure.
- **Bulk RAG pattern fetch**: `getPatternsByContractType()` returns all patterns for a contract type in one SQL query. Patterns injected into the system prompt via `formatPatternsForPrompt()`. Orchestrator includes `RAG_TYPE_MAP` fallback: if specific type (e.g. `residential_lease`) returns 0 results, tries base type (`lease`).
- **matchedPatterns**: Computed by `computeMatchedPatterns()` running in parallel with the analysis call. Enriched in DB after the stream completes. Real-time `clause_analysis` events have `matchedPatterns: []`.
- **clauseBreakdown**: Computed deterministically from tracked clause risk levels, NOT by Claude.
- **Summary**: Preferably from the `report_summary` tool call in the combined analysis. Falls back to separate `summarize()` call if Claude doesn't call the tool.
- **Resumable pipeline**: Orchestrator caches parse results in `analyses.parsedClauses`. On resume, replays existing clauses and only sends remaining positions to the combined analysis.
- **Heartbeat**: After each yielded event, orchestrator updates `analyses.updatedAt` to prevent stale reclaim.
- **clause_positions event**: Emitted immediately after parse (both fresh and resume) for frontend skeleton cards.
- **max_tokens estimation**: `Math.min(clauseCount * 300 + 4096, 64000)` — ~300 tokens per clause average (green clauses use ~50 tokens with brief explanations, red/yellow use ~600 with conciseness guidance) + 4K buffer. Cap at 64K (Sonnet 4.6 max output).
- **RAG degradation**: If Voyage API is down, `computeMatchedPatterns` fails gracefully — `matchedPatterns` stays empty, analysis proceeds normally.
- **Structured logging**: All agents and orchestrator use `logger` from `@redflag/shared`.

## Rules

- Agents are **pure async functions** — no classes, no state. Input → output.
- Every Claude response must be validated against a Zod schema (shared or internal)
- Document text is **untrusted input** — system prompts must instruct Claude to analyze objectively
- Claude models: Haiku for relevance gate + boundary detection fallback, Sonnet for combined analysis + summary
- All source files must be under `src/` (TypeScript `rootDir` constraint)
- Retry pattern: 2 attempts (for loop 0..1), catch any error, yield error event after both fail
