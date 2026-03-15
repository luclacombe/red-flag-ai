# @redflag/agents

Agent pipeline — pure async functions for each step of contract analysis.

## What's Here

- `src/client.ts` — Shared Anthropic client factory (`getAnthropicClient()`) + model ID constants (`MODELS.haiku`, `MODELS.sonnet`)
- `src/gate.ts` — Relevance gate agent (`relevanceGate(text)` → `GateResult`). Uses Haiku, retries once on failure.
- `src/parse.ts` — Parse agent (`parseClauses(text, contractType, language)` → `ParsedClause[]`). Returns verbatim clause text; positions computed by orchestrator. Dynamic `max_tokens` via `estimateMaxTokens(textLen)` — scales with document size (4096–32768). Detects truncation via `stop_reason === "max_tokens"` before JSON parse.
- `src/risk.ts` — Risk agent (`analyzeClause(clause, patterns, language)` → `RiskAnalysisResult`). Receives pre-retrieved RAG patterns. Internal `RiskAnalysisResult` type (riskLevel, explanation, category).
- `src/rewrite.ts` — Rewrite agent (`rewriteClause(clauseText, riskLevel, explanation, language)` → `string`). Only called for red/yellow clauses.
- `src/summary.ts` — Summary agent (`summarize(analyses, contractType, language)` → `Omit<Summary, "clauseBreakdown">`). `clauseBreakdown` computed by orchestrator.
- `src/orchestrator.ts` — Pipeline orchestrator (`analyzeContract(params)` async generator → `SSEEvent`). Chains all agents, handles errors, persists to DB. Also exports `computeClausePositions()`.
- `src/prompts/` — System prompts + user message builders (one file per agent: gate, parse, risk, rewrite, summary)
- `src/__tests__/` — Unit tests for all agents (gate, parse, risk, rewrite, summary), orchestrator, PDF extraction, positions
- `src/__tests__/fixtures/generate-pdf.ts` — Minimal valid PDF generator for tests (no deps)

## Pipeline

```
Upload → [Relevance Gate] → [Parse Agent] → [Risk Agent + RAG] → [Rewrite Agent] → [Summary Agent]
```

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `@redflag/shared` — Zod schemas, types (`ParsedClause`, `PositionedClause`, `ClauseAnalysis`, `Summary`, `SSEEvent`, etc.)
- `@redflag/db` — Database client, schema tables, embedding functions, `findSimilarPatterns()`, Drizzle operators (`eq`)
- `zod` — Internal agent response validation schemas
- `unpdf` (dev only) — PDF text extraction for tests

## Key Design Details

- **Intermediate types**: Parse agent returns `ParsedClause` (text + position only). Orchestrator computes `startIndex`/`endIndex` via `indexOf()` → `PositionedClause`. Risk agent returns internal `RiskAnalysisResult`. Orchestrator assembles full `ClauseAnalysis`.
- **matchedPatterns**: Computed programmatically by orchestrator (similarity >= 0.7 threshold), NOT reported by Claude.
- **clauseBreakdown**: Computed deterministically by orchestrator, NOT by Claude.
- **Batch embedding**: Orchestrator embeds all clause texts in one Voyage API call (chunks of 128).
- **Position clamping**: `computeClausePositions` returns -1 for unfound text; orchestrator clamps to 0/1 before DB insert.
- **RAG degradation**: If Voyage API is down, orchestrator skips RAG and appends note to explanations.
- **Structured logging**: All agents and orchestrator use `logger` from `@redflag/shared` — JSON-structured logs with `timestamp`, `level`, `message`, metadata fields. No raw `console.log`.
- **Dynamic max_tokens**: Parse agent uses `estimateMaxTokens(textLen)` (chars/3 + 512, clamped 4096–32768) instead of a static value. On retry, budget increases by 50%. Always check `stop_reason` before parsing JSON — a static `max_tokens` caused production truncation on large documents.
- **SSE keepalive during parse**: Orchestrator sends "Still parsing contract clauses..." status events every 15s while the parse agent runs, preventing SSE connection timeouts on Vercel. Uses `Promise.race` pattern with the parse promise.

## Rules

- Agents are **pure async functions** — no classes, no state. Input → output.
- Every Claude response must be validated against a Zod schema (shared or internal)
- Document text is **untrusted input** — system prompts must instruct Claude to analyze objectively
- RAG vector search is called from `@redflag/db`, not implemented here
- Claude models: Haiku for relevance gate, Sonnet for all other agents
- All source files must be under `src/` (TypeScript `rootDir` constraint)
- Retry pattern: 2 attempts (for loop 0..1), catch any error, throw descriptive error after both fail
