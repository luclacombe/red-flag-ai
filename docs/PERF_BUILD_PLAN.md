# RedFlag AI — Performance Restructuring Plan

> This plan restructures the agent pipeline from ~40 API calls (4-5 min) to 3 API calls (~20-30 sec).
> Each phase = one focused Claude Code session.
> Start each session: `"Read docs/PERF_BUILD_PLAN.md, begin Phase N"`
> End each session: quality gate passes → update checkboxes → commit

---

## Problem Statement

The current pipeline is too slow to be a viable product. A 25KB Dutch lease takes 4-5+ minutes with frequent Vercel 300s timeouts, JSON parse failures, and reconnection loops. By comparison, pasting the same document into Claude.com with a good prompt yields ~80% of the quality in ~30-60 seconds.

**Root causes identified (with Vercel production logs):**

| Problem | Impact | Evidence |
|---------|--------|----------|
| Parse agent sends entire document to Sonnet, asks it to copy every clause verbatim as JSON | 3+ minutes for a single API call | Logs: parse started 11:48:32, response at 11:51:35 (3 min 3 sec) |
| Fragile JSON output — one bad character kills the entire parse | Parse failed on first attempt, retry consumed another 2+ min | `"Expected ',' or '}' after property value in JSON at position 3216"` |
| ~40 separate Claude API calls per document (1 parse + ~20 risk + ~10 rewrite + 1 summary) | Aggregate latency and failure probability is enormous | Multiple Vercel 300s timeouts across reconnections |
| Per-clause Voyage embedding + pgvector search | Adds 1-3s overhead per document | Embedding batch call + N vector similarity queries |
| No streaming from Claude — fire-and-forget `messages.create()` | User sees nothing until entire response completes | First clause result arrives after 3+ min (post-parse) |

**Target:** 15-20x faster. First clause result in ~5 seconds. Full analysis in ~20-30 seconds. Zero JSON parse errors.

---

## Architecture Decisions (New / Changed)

Decisions from `BUILD_PLAN.md` still hold unless overridden here.

| Decision | Old | New | Rationale |
|----------|-----|-----|-----------|
| Clause parsing | Claude Sonnet, single call, verbatim JSON extraction (~3 min) | **TypeScript heuristic splitter** — regex-based structural detection (<10ms) | Every commercial legal AI tool (Klarity, Relativity, LexCheck) does structural segmentation first. Contracts follow predictable numbering patterns across languages. |
| Clause analysis | Separate Risk (×N) + Rewrite (×N) Claude calls — ~30 calls total | **Single streaming Claude call with `report_clause` tool_use** — 1 call | Claude can call the same tool multiple times in one response. Each tool call streams independently. |
| JSON reliability | `stripCodeFences` + `JSON.parse` + Zod + retry on failure | **`strict: true` structured outputs** — constrained decoding | Claude physically cannot produce tokens that violate the schema. Zero parse errors. |
| Streaming granularity | Non-streaming `messages.create()`, results after full response | **`eager_input_streaming: true`** — fine-grained tool streaming | Each `report_clause` tool call streams to client as it's generated. First result in ~5s. |
| RAG retrieval | Per-clause: embed clause → pgvector search → inject top-5 patterns | **Bulk pre-fetch**: 1 SQL query filtered by contract type → inject ALL relevant patterns in system prompt | With only 100-200 patterns, filtered to ~20-50 by type. Eliminates all per-clause Voyage + DB calls. |
| Pipeline shape | Gate → Parse → Embed → [Risk + RAG + Rewrite] ×N → Summary = ~40 calls | **Gate → Heuristic Parse → Bulk RAG → Combined Analysis (streaming) → Summary = 3 calls** | 15-20x fewer API calls, 15-20x faster |
| Claude models | Haiku for gate, Sonnet for everything else | Haiku for gate, **Sonnet for combined analysis + summary** (test Haiku for combined if quality holds) | Sonnet needed for nuanced risk analysis. Haiku 4.5 has 64K output — worth testing. |

## New End-to-End Analysis Flow

```
1. Client uploads PDF          → POST /api/upload (unchanged)
2. Server validates            → file type, size, page count ≤30 (unchanged)
3. Server stores PDF           → Supabase Storage (unchanged)
4. Server extracts text        → unpdf (unchanged)
5. Server runs relevance gate  → Claude Haiku (unchanged)
6. If not contract             → rejection (unchanged)
7. If contract                 → create document + analysis records (unchanged)
8. Server returns              → { analysisId } (unchanged)
9. Client navigates            → /analysis/[analysisId] (unchanged)
10. Client subscribes          → tRPC SSE subscription (unchanged)
11. Server emits               → { type: "status", message: "Parsing..." }
12. *** NEW: Heuristic parse   → TypeScript regex splitter (<10ms)
13. Server emits               → { type: "clause_positions", data: [...] } (skeleton cards)
14. *** NEW: Bulk RAG fetch    → 1 SQL query: all patterns for contract type (<50ms)
15. *** NEW: Combined analysis → 1 streaming Claude call with report_clause tool
    For each clause (streaming):
      a. Claude calls report_clause tool → risk + explanation + category + rewrite
      b. Compute positions via indexOf()
      c. Persist clause to DB
      d. Yield to client → { type: "clause_analysis", data: ClauseAnalysis }
16. Summary Agent              → 1 Claude call (unchanged pattern)
17. Persist summary            → update analysis record
18. Yield summary              → { type: "summary", data: Summary }
19. Close stream
```

**Timing budget:**
- Steps 1-11: ~3-5s (upload + gate + navigation — unchanged)
- Step 12: <10ms (heuristic parse — instant)
- Step 13: <10ms (emit clause positions)
- Step 14: <50ms (bulk RAG query)
- Step 15: ~15-25s (single streaming Claude call, first result at ~3-5s)
- Steps 16-18: ~3-5s (summary)
- **Total: ~20-30 seconds, first clause at ~8-10 seconds from upload**

---

## Research Context

> Each phase references specific research findings. This section is the index.
> Full research was conducted across 5 parallel agents covering: clause segmentation,
> single-pass LLM patterns, RAG optimization, parallelization/streaming, and Anthropic API features.

### Key Research References

**Heuristic clause segmentation:**
- Every commercial legal AI tool does structural segmentation first (regex/formatting), then ML/LLM for classification only
- Relativity Contracts uses editable regex rules for section heading detection
- Contract numbering patterns are language-agnostic: `1.`, `1.1`, `Article 1`, `RENT`, roman numerals
- Multilingual heading keywords: NL (`Artikel`, `Bepaling`), FR (`Article`, `Chapitre`), DE (`Abschnitt`, `Paragraph`)
- No production-quality open-source JS/TS library exists — we build our own (~100-200 lines)

**Claude tool_use for streaming structured output:**
- Claude can call the same tool multiple times in one response (confirmed in Anthropic docs)
- `strict: true` on tool definitions = constrained decoding — physically impossible to produce invalid JSON
- `eager_input_streaming: true` = fine-grained streaming without buffering (GA on Claude 4 models)
- `token-efficient tool use` is built into Claude 4 models (up to 70% output token savings)
- 64K max output tokens on all current models — 20 clauses × ~400 tokens each = ~8K, well within limits
- Sources: [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Fine-Grained Tool Streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming), [Tool Use Overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)

**RAG optimization:**
- With 100-200 patterns filtered to ~20-50 by contract type, system prompt injection is viable and near-zero latency
- Robin AI research: clause-level retrieval with metadata delivered highest impact; only 15% of contract text needed for 90% recall
- "Lost in the middle" research: 3-5 retrieved docs per query is the sweet spot; beyond that, LLM starts ignoring middle content
- Hybrid approach: inject all contract-type patterns in system prompt (broad coverage) + optional per-clause vector similarity for `matchedPatterns` field (can be computed in-memory)
- Sources: [Robin AI Research](https://robinai.com/news-and-resources/blog/optimizing-rag-for-contract-analysis-our-research-findings-2), [Supabase Hybrid Search](https://supabase.com/docs/guides/ai/hybrid-search)

**Prompt caching (for summary call):**
- Cache system prompt + document context between analysis and summary calls
- Cached reads cost 10% of base input token price
- 5-minute default TTL — pipeline completes well within this window
- Minimum cacheable: 1,024 tokens for Sonnet 4.x
- Source: [Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

---

## Phase 1: Foundation — Heuristic Parser + RAG Restructure

**Objective:** Replace the 3-minute LLM parse with an instant heuristic splitter, and restructure RAG to bulk-fetch patterns instead of per-clause embedding + vector search. No changes to the analysis pipeline yet — the old orchestrator still works with the new parse output. This phase is non-breaking.

**Entry criteria:** Current MVP pipeline works (even if slow). All packages build. Knowledge base seeded.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file), `CLAUDE.md`, and the current code:
- `packages/agents/src/parse.ts` — current LLM parse (being replaced)
- `packages/agents/src/orchestrator.ts` — current orchestrator (will use new parse)
- `packages/agents/src/prompts/parse.ts` — current parse prompt (will be unused)
- `packages/db/src/queries/findSimilarPatterns.ts` — current per-clause vector search
- `packages/db/src/embeddings.ts` — current Voyage AI embedding functions
- `packages/shared/src/` — existing Zod schemas and types

### Tasks

#### 1.1 — Heuristic clause splitter

- [x] Create `packages/agents/src/heuristic-parse.ts`
- [x] Implement `parseClausesHeuristic(text: string, contractType: string, language: string)` → `ParsedClause[]`
- [x] **Must return the same `ParsedClause[]` shape** as the current `parseClauses()` — `{ text: string, position: number }`. This ensures the rest of the pipeline works unchanged.
- [x] Auto-detect heading pattern by scanning the first ~2000 characters for known structures:
  ```
  Priority order (first match wins):
  1. Dotted decimal:  /^\s*\d+(\.\d+)*\.?\s/m         → "1.", "1.1", "2.3.4"
  2. Article keyword: /^\s*(article|artikel|...)\s+/im  → "Article 1", "Artikel 3"
  3. ALL-CAPS heading: /^\s*[A-Z][A-Z\s]{2,}$/m        → "RENT", "TERMINATION"
  4. Roman numerals: /^\s*[IVXLC]+\.\s/m               → "I.", "II.", "III."
  5. Parenthetical:  /^\s*\([a-z\d]+\)\s/m             → "(a)", "(1)"
  ```
- [x] Include multilingual heading keywords in article keyword pattern:
  ```
  EN: article, section, clause, part, schedule
  NL: artikel, bepaling, lid, afdeling
  FR: chapitre, alinéa (article/section/clause shared with EN)
  DE: abschnitt, paragraph, klausel, absatz (artikel shared with NL)
  ```
- [x] Split document on detected boundaries — each section heading + body until next heading = one clause
- [x] Handle edge cases:
  - Merge fragments < 50 characters into the previous clause
  - If no headings detected, fall back to double-newline (`\n\n`) paragraph splitting
  - If paragraph splitting produces < 3 or > 60 segments, treat the entire document as a single clause (let the analysis call segment it)
  - Skip non-clause content: preambles that only identify parties, signature blocks, date-only lines
  - Preserve clause heading/number in the text (same behavior as current LLM parse)
- [x] Handle nested sub-sections: top-level sections are clauses; sub-sections stay within their parent (same rule as current parse prompt)
- [x] **No LLM call at all.** This must run in <10ms for a 25KB document.

#### 1.2 — Bulk RAG pattern fetch

- [x] Create `packages/db/src/queries/getPatternsByContractType.ts`
- [x] Implement `getPatternsByContractType(contractType: string)` → `KnowledgePattern[]`:
  ```sql
  SELECT id, clause_pattern, category, contract_type, risk_level,
         why_risky, safer_alternative, jurisdiction_notes, embedding
  FROM knowledge_patterns
  WHERE contract_type @> $1::jsonb
  ORDER BY category, risk_level DESC
  ```
- [x] Returns all patterns for the given contract type (typically ~20-50 from the 100-200 total)
- [x] Include the `embedding` vector in the result — needed for optional in-memory similarity scoring
- [x] Export from `packages/db/src/index.ts`
- [x] **Keep existing `findSimilarPatterns()` and `embedTexts()` intact** — they're still used by the current orchestrator until Phase 2 replaces it

#### 1.3 — Format RAG patterns for prompt injection

- [x] Create `packages/agents/src/format-patterns.ts`
- [x] Implement `formatPatternsForPrompt(patterns: KnowledgePattern[])` → `string`:
  - Groups patterns by category for readability
  - For each pattern: risk level, clause pattern, why risky, safer alternative
  - Output is a structured text block suitable for a Claude system prompt
  - Target: ~50-200 tokens per pattern, ~2K-8K tokens total for a contract type
- [x] Implement `findTopMatchesInMemory(clauseText: string, clauseEmbedding: number[], patterns: KnowledgePatternWithEmbedding[], topK: number)` → `{ patternId: string, similarity: number }[]`:
  - Cosine similarity computed in pure TypeScript (no DB, no Voyage API)
  - Used to populate the `matchedPatterns` field on each clause
  - Only patterns above `PATTERN_MATCH_THRESHOLD` (0.7) are included
- [x] Export from `packages/agents/src/index.ts`

#### 1.4 — Add `clause_positions` SSE event type

- [x] Add new event type to `packages/shared/src/` SSE event schemas:
  ```typescript
  ClausePositionsEvent → {
    type: "clause_positions",
    data: { totalClauses: number, clauses: { text: string, position: number }[] }
  }
  ```
- [x] Add to the `SSEEvent` discriminated union
- [x] This event enables the frontend to render skeleton cards immediately after parsing
- [x] Update `packages/shared/CLAUDE.md` if new types/exports are added

#### 1.5 — Embed clause texts for matchedPatterns (single batch call)

The `matchedPatterns` field on each clause requires knowing which knowledge base patterns are semantically similar. With the new architecture, we still need clause embeddings for this — but we do one batch Voyage call and compute similarity in-memory against pre-fetched patterns (no per-clause DB queries).

- [x] Create `packages/agents/src/compute-matched-patterns.ts`
- [x] Implement `computeMatchedPatterns(clauses: ParsedClause[], patterns: KnowledgePatternWithEmbedding[])` → `Map<number, string[]>`:
  - Batch-embeds all clause texts in one Voyage API call (reuse existing `embedTexts()` from `@redflag/db`)
  - For each clause, computes cosine similarity against all pre-fetched pattern embeddings in memory
  - Returns a map of `position → patternId[]` for patterns above threshold
  - Handles Voyage API failure gracefully: returns empty map (RAG degraded mode)
- [x] This runs in parallel with the combined analysis call in Phase 2 — for now, just build and test it

#### 1.6 — Tests

- [x] **Heuristic parser tests** (`packages/agents/src/__tests__/heuristic-parse.test.ts`):
  - Dutch lease with numbered sections (use actual text from test PDF if available, or representative fixtures)
  - English contract with `Article` headings
  - Contract with ALL-CAPS headings
  - Contract with no clear headings → falls back to paragraph splitting
  - Very short document → single clause fallback
  - Fragments < 50 chars → merged into previous clause
  - Verify output shape matches `ParsedClause[]`
  - Verify performance: <10ms for a 25KB input (use `performance.now()`)
- [x] **Bulk pattern fetch tests** (`packages/db/src/__tests__/getPatternsByContractType.test.ts`):
  - Mock DB to return filtered patterns
  - Verify SQL query filters by contract type
  - Verify results include embedding vectors
- [x] **In-memory similarity tests** (`packages/agents/src/__tests__/compute-matched-patterns.test.ts`):
  - Cosine similarity computation against known vectors
  - Threshold filtering
  - Voyage API failure → empty map gracefully
- [x] **Pattern formatting tests** (`packages/agents/src/__tests__/format-patterns.test.ts`):
  - Verify output groups by category
  - Verify token-reasonable output size
- [x] Run existing tests to verify nothing is broken: `pnpm turbo test`

#### 1.7 — Validate heuristic parser against real documents

- [x] If a test PDF exists in the repo (check `packages/agents/src/__tests__/fixtures/`), use it
- [x] If not, create a representative fixture: a ~20-clause contract with numbered sections
- [x] Compare heuristic parse output vs what the LLM parse would produce:
  - Same number of clauses (±2)?
  - Same clause boundaries?
  - Any clauses missed or incorrectly split?
- [x] Document any edge cases found and handle them

#### 1.8 — Update CLAUDE.md files

- [x] Update `packages/agents/CLAUDE.md`: document new files, exports, heuristic parse approach
- [x] Update `packages/db/CLAUDE.md`: document new `getPatternsByContractType` query
- [x] Update `packages/shared/CLAUDE.md` if new SSE event types were added

### MCP Usage
- **Context7**: If unsure about Zod v4 schema syntax, Drizzle query syntax, or Vitest patterns
- **Supabase MCP**: Verify `getPatternsByContractType` query returns correct results against the production knowledge base

### Quality Gate
```bash
pnpm turbo lint type-check test build
# All existing tests still pass (non-breaking change)
# New heuristic parser tests pass
# New RAG query tests pass
```

### Exit Criteria
- [x] Heuristic parser splits a 25KB document in <10ms
- [x] Heuristic parser handles Dutch, English, French, German heading patterns
- [x] Fallback to paragraph splitting works for unstructured documents
- [x] Bulk RAG fetch returns all patterns for a given contract type in a single query
- [x] In-memory cosine similarity matches patterns correctly
- [x] Pattern formatting produces a readable, token-efficient text block
- [x] `clause_positions` SSE event type exists in shared schemas
- [x] All existing tests still pass (zero regressions)
- [x] All new tests pass
- [x] Quality gate passes
- [x] `packages/agents/CLAUDE.md` and `packages/db/CLAUDE.md` updated
- [ ] Commit: `perf(agents,db): heuristic clause parser and bulk RAG pattern fetch`

---

## Phase 2: Core — Combined Streaming Analysis with Tool Use

**Objective:** Replace the ~30 separate risk + rewrite Claude calls with a single streaming call using the `report_clause` tool pattern. Wire the new heuristic parser and bulk RAG into the orchestrator. This is the core performance fix — the pipeline goes from ~40 API calls to 3.

**Entry criteria:** Phase 1 complete. Heuristic parser and bulk RAG query working and tested.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file), `CLAUDE.md`, and:
- `packages/agents/src/heuristic-parse.ts` — new heuristic parser (Phase 1)
- `packages/agents/src/format-patterns.ts` — pattern formatting + in-memory similarity (Phase 1)
- `packages/agents/src/compute-matched-patterns.ts` — batch embed + similarity (Phase 1)
- `packages/agents/src/orchestrator.ts` — current orchestrator (being restructured)
- `packages/agents/src/client.ts` — Anthropic client factory + model constants
- `packages/agents/src/risk.ts` — current risk agent (being replaced by combined call)
- `packages/agents/src/rewrite.ts` — current rewrite agent (being replaced by combined call)
- `packages/agents/src/summary.ts` — summary agent (small updates)
- `packages/agents/src/prompts/` — all current prompts
- `packages/api/src/routers/analysis.ts` — tRPC SSE router (updates for new events)
- `packages/shared/src/` — SSE event types

**Critical Anthropic API references — read these docs before coding:**
- [Tool Use Overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — how to define tools, multiple tool calls in one response
- [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — `strict: true` for guaranteed JSON
- [Fine-Grained Tool Streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming) — `eager_input_streaming` for real-time streaming
- [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming) — event types, `content_block_start`/`delta`/`stop`
- [Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — `cache_control` for system prompt reuse
- Use **Context7 MCP** to fetch the latest Anthropic SDK docs if any API details are unclear.

### Tasks

#### 2.1 — Combined analysis prompt

- [ ] Create `packages/agents/src/prompts/combined-analysis.ts`
- [ ] System prompt must:
  - Frame document text as untrusted input (prompt injection defense)
  - Instruct Claude to analyze each clause for risk, explain in plain language, suggest rewrites for flagged clauses
  - Instruct Claude to call the `report_clause` tool once per clause in document order
  - Instruct Claude to respond in the document's language
  - Include contract type and language metadata
  - Include all RAG patterns for the contract type (formatted by `formatPatternsForPrompt()`)
- [ ] User message builder:
  - Takes the heuristically-parsed clauses as input
  - Formats them as a numbered list: `[1] "clause text here"`, `[2] "clause text here"`, etc.
  - Places analysis instructions AFTER the clauses (Anthropic recommendation: instructions after document for long-context analysis)
- [ ] Prompt should instruct Claude:
  - For each clause: determine risk level (red/yellow/green), explain why, categorize, and provide a safer alternative if red or yellow
  - Call `report_clause` tool once per clause with results
  - After all clauses, call `report_summary` tool with overall assessment
  - Do NOT copy clause text verbatim in the tool call — reference by position number. The orchestrator maps back to the original text. This dramatically reduces output tokens.

#### 2.2 — Tool definitions

- [ ] Define `report_clause` tool schema:
  ```typescript
  {
    name: "report_clause",
    description: "Report risk analysis for a single contract clause",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        position: { type: "integer", description: "Zero-based clause position from the input list" },
        riskLevel: { type: "string", enum: ["red", "yellow", "green"] },
        explanation: { type: "string", description: "Plain-language risk explanation in document language" },
        category: { type: "string", description: "Risk category (e.g. termination, liability, rent)" },
        saferAlternative: {
          type: "string",
          description: "Fairer rewrite of the clause. Required for red/yellow, empty string for green."
        }
      },
      required: ["position", "riskLevel", "explanation", "category", "saferAlternative"]
    }
  }
  ```
- [ ] Define `report_summary` tool schema:
  ```typescript
  {
    name: "report_summary",
    description: "Report overall contract risk summary after analyzing all clauses",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        overallRiskScore: { type: "integer", minimum: 0, maximum: 100 },
        recommendation: { type: "string", enum: ["sign", "caution", "do_not_sign"] },
        topConcerns: { type: "array", items: { type: "string" } }
      },
      required: ["overallRiskScore", "recommendation", "topConcerns"]
    }
  }
  ```
- [ ] **Note on `strict: true`**: First request with a new schema has ~100-300ms overhead for grammar compilation; cached for 24 hours after. This is a one-time cost.
- [ ] Both tools must be registered in the single `messages.create()` call with `tool_choice: { type: "auto" }`

#### 2.3 — Streaming tool call handler

- [ ] Create `packages/agents/src/combined-analysis.ts`
- [ ] Implement `analyzeAllClauses(params)` as an async generator that yields `SSEEvent`:
  ```typescript
  interface CombinedAnalysisParams {
    clauses: ParsedClause[];
    contractType: string;
    language: string;
    ragPatterns: KnowledgePattern[];  // pre-fetched by contract type
  }
  ```
- [ ] Use the Anthropic SDK streaming API: `client.messages.stream()` or `client.messages.create({ stream: true })`
- [ ] Listen for streaming events:
  - `content_block_start` with `type: "tool_use"` — a new tool call is starting
  - `content_block_delta` with `type: "input_json_delta"` — incremental tool input JSON
  - `content_block_stop` — tool call is complete, parse the accumulated JSON
  - `message_stop` — entire response is complete
- [ ] When a `report_clause` tool call completes:
  1. The accumulated JSON is already guaranteed valid by `strict: true`
  2. Map `position` back to the original clause from `params.clauses`
  3. Compute `startIndex`/`endIndex` via `text.indexOf()` (existing `computeClausePositions` logic)
  4. Yield `{ type: "clause_analysis", data: ClauseAnalysis }`
- [ ] When `report_summary` tool call completes:
  1. Compute `clauseBreakdown` deterministically from accumulated results
  2. Yield `{ type: "summary", data: Summary }`
- [ ] Handle errors:
  - If Claude's response is cut off (`stop_reason: "max_tokens"`): yield error event for any unanalyzed clauses, yield partial summary
  - If Claude API returns a 429/500: retry once with exponential backoff, then yield error
  - If a tool call has an unexpected `position` value: log warning, skip
- [ ] **Do NOT use `tool_choice: { type: "any" }`** — use `"auto"` so Claude can emit text between tool calls if needed
- [ ] After the streaming response completes, check that all clause positions were covered. Log a warning for any missing positions.

#### 2.4 — Restructure orchestrator

- [ ] Rewrite `packages/agents/src/orchestrator.ts` to use the new pipeline:
  ```typescript
  async function* analyzeContract(params: AnalyzeContractParams): AsyncGenerator<SSEEvent> {
    // Step 1: Heuristic parse (instant)
    const rawClauses = parseClausesHeuristic(text, contractType, language);
    const positionedClauses = computeClausePositions(text, rawClauses);

    // Emit clause positions for frontend skeleton cards
    yield { type: "clause_positions", data: { totalClauses: positionedClauses.length, clauses: ... } };
    yield { type: "status", message: `Found ${positionedClauses.length} clauses. Analyzing...` };

    // Step 2: Bulk RAG fetch (single SQL query, <50ms)
    const ragPatterns = await getPatternsByContractType(contractType);

    // Step 3: Combined streaming analysis (single Claude call)
    // Also kick off batch embedding in parallel for matchedPatterns
    const embeddingPromise = computeMatchedPatterns(positionedClauses, ragPatterns)
      .catch(() => new Map<number, string[]>());  // graceful degradation

    const allAnalyses: ClauseAnalysis[] = [];
    for await (const event of analyzeAllClauses({
      clauses: positionedClauses,
      contractType,
      language,
      ragPatterns,
    })) {
      if (event.type === "clause_analysis") {
        // Enrich with matchedPatterns once embedding completes
        allAnalyses.push(event.data);
        // Persist to DB
        await db.insert(clauses).values({ ... });
      }
      yield event;
      await heartbeat(analysisId);
    }

    // Step 4: Enrich with matchedPatterns
    const matchedMap = await embeddingPromise;
    // Update clauses in DB with matchedPatterns (batch update)

    // Step 5: Mark complete
    await db.update(analyses).set({ status: "complete", ... });
  }
  ```
- [ ] **Resumability**: Cache parse results in `analyses.parsedClauses` (same as before). If resuming, check for already-analyzed clauses in DB and replay them. For the combined analysis, skip already-analyzed positions in the prompt.
- [ ] **Heartbeat**: Update `analyses.updatedAt` after each yielded clause event (same pattern as before)
- [ ] **Keep the `computeClausePositions()` function** — it still computes `startIndex`/`endIndex`
- [ ] Remove imports of old `parseClauses`, `analyzeClause`, `rewriteClause` from the orchestrator
- [ ] The summary can come from the `report_summary` tool call in the combined analysis. If Claude doesn't call it (edge case), fall back to a separate `summarize()` call.

#### 2.5 — Update tRPC analysis router

- [ ] Update `packages/api/src/routers/analysis.ts`:
  - Handle the new `clause_positions` event type in the SSE stream
  - The polling path (when another connection is processing) should also emit `clause_positions` when available from cached parse results
  - The `complete` replay path should reconstruct `clause_positions` from stored clauses
- [ ] Verify the `claimAnalysis()` atomic claim still works with the new pipeline
- [ ] Verify the stale detection (90s heartbeat threshold) still works

#### 2.6 — Summary agent refinements

- [ ] The combined analysis call includes a `report_summary` tool, which may produce the summary inline
- [ ] If the summary comes from the combined call, skip the separate `summarize()` call
- [ ] If the summary is missing from the combined call (Claude didn't call the tool), fall back to a separate `summarize()` call
- [ ] Add prompt caching to the fallback summary call:
  ```typescript
  system: [
    { type: "text", text: SUMMARY_SYSTEM_PROMPT },
    { type: "text", text: analysisContext, cache_control: { type: "ephemeral" } }
  ]
  ```

#### 2.7 — Remove old per-clause agents from pipeline

- [ ] **Do NOT delete the old files yet** — keep `risk.ts`, `rewrite.ts`, `parse.ts` in the repo for reference and test comparison. They are no longer imported by the orchestrator.
- [ ] Remove the old per-clause batch processing loop from the orchestrator
- [ ] Remove the `batchEmbed()` call that happened before clause processing (replaced by `computeMatchedPatterns()` running in parallel)
- [ ] Remove the per-clause `findSimilarPatterns()` calls
- [ ] Verify `packages/agents/src/index.ts` exports the new functions

#### 2.8 — Tests

- [ ] **Combined analysis tests** (`packages/agents/src/__tests__/combined-analysis.test.ts`):
  - Mock streaming Claude response with multiple `report_clause` tool calls
  - Verify each tool call produces a valid `ClauseAnalysis` event
  - Verify `report_summary` tool call produces a valid `Summary` event
  - Verify `strict: true` is set on tool definitions
  - Verify error handling: `stop_reason: "max_tokens"` → partial results
  - Verify error handling: API error → retry once, then error event
  - Verify missing clause positions are logged
- [ ] **Orchestrator integration tests** (`packages/agents/src/__tests__/orchestrator.test.ts`):
  - Update existing orchestrator tests to work with the new pipeline
  - Mock heuristic parse, bulk RAG, and combined analysis
  - Verify event sequence: `clause_positions → status → clause_analysis (×N) → summary`
  - Verify resumability: cached parse → skip parse, replay existing clauses
  - Verify heartbeat after each clause event
- [ ] **tRPC router tests** (`packages/api/src/__tests__/analysis.test.ts`):
  - Update to handle new `clause_positions` event
  - Verify `claimAnalysis()` still works
- [ ] Run full test suite: `pnpm turbo test`

#### 2.9 — Local end-to-end validation

- [ ] Run `pnpm dev` and upload a contract PDF
- [ ] Verify:
  - Heuristic parse completes instantly (no "Parsing..." delay)
  - Clause skeleton positions arrive immediately
  - Clause analyses stream in one by one
  - Summary appears at the end
  - Total time: <30 seconds for a typical contract
  - No JSON parse errors
  - All clauses have valid risk levels, explanations, categories
  - Red/yellow clauses have safer alternatives
  - matchedPatterns populated (after embedding completes)
- [ ] Check structured logs for timing data

#### 2.10 — Update CLAUDE.md files

- [ ] Update `packages/agents/CLAUDE.md`:
  - Document new combined analysis approach
  - Document `report_clause` and `report_summary` tool definitions
  - Document `strict: true` and `eager_input_streaming` usage
  - Note that old per-clause agents (`risk.ts`, `rewrite.ts`, `parse.ts`) are retained but unused
  - Update pipeline diagram
- [ ] Update `packages/api/CLAUDE.md`: document new `clause_positions` event handling
- [ ] Update root `CLAUDE.md`:
  - Update "Pipeline model" in architecture decisions
  - Update "Claude models" notes
  - Add note about `strict: true` structured outputs
  - Update the E2E flow description
  - Update performance characteristics

### MCP Usage
- **Context7**: Anthropic SDK streaming API, tool_use with streaming, Drizzle batch operations
- **Supabase MCP**: Verify clauses persist correctly during streaming pipeline

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Upload a real PDF locally and verify streaming works
# Total pipeline time < 30 seconds
```

### Exit Criteria
- [ ] Single streaming Claude call replaces ~30 separate risk + rewrite calls
- [ ] `strict: true` produces guaranteed valid JSON (zero parse errors)
- [ ] `eager_input_streaming` delivers clause results as they're generated
- [ ] Heuristic parse + bulk RAG + combined analysis = 3 API calls total (gate + analysis + optional summary fallback)
- [ ] First clause result arrives within ~5 seconds of analysis start
- [ ] Full pipeline completes in <30 seconds for a typical contract
- [ ] Resumability still works (cached parse, replay existing clauses)
- [ ] matchedPatterns populated via in-memory similarity
- [ ] Summary produced (either inline from combined call or fallback separate call)
- [ ] All tests pass
- [ ] Quality gate passes
- [ ] CLAUDE.md files updated in agents, api, and root
- [ ] Commit: `perf(agents): single streaming analysis call with tool_use, 15-20x faster`

---

## Phase 3: Polish — Frontend UX + Cleanup + Deployment Validation

**Objective:** Update the frontend to take advantage of instant parsing (skeleton cards), clean up dead code, run full smoke tests on production, and validate the 15-20x performance improvement.

**Entry criteria:** Phase 2 complete. Pipeline works locally with 3 API calls and <30s total time.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file), `CLAUDE.md`, and:
- `apps/web/src/components/analysis-view.tsx` — main analysis page client component
- `apps/web/src/components/clause-card.tsx` — clause card component
- `apps/web/src/components/clause-skeleton.tsx` — skeleton loader
- `apps/web/src/components/status-bar.tsx` — status bar
- `apps/web/src/components/summary-panel.tsx` — summary panel
- `packages/shared/src/` — SSE event types (including new `clause_positions`)
- `packages/agents/src/orchestrator.ts` — new orchestrator (Phase 2)
- `packages/agents/src/risk.ts`, `rewrite.ts`, `parse.ts` — old agents (to be removed)

### Tasks

#### 3.1 — Handle `clause_positions` event in frontend

- [ ] Update `apps/web/src/components/analysis-view.tsx` to handle the `clause_positions` SSE event:
  - When received, immediately render skeleton cards for ALL clauses (one per position)
  - Each skeleton card should show the clause number and occupy the correct vertical space
  - This gives users an instant structural preview of the document
- [ ] The skeleton cards should use the existing `ClauseSkeleton` component
- [ ] As `clause_analysis` events arrive, replace the corresponding skeleton with a real `ClauseCard`:
  - Match by `position` field
  - Animate the transition: skeleton → colored card (CSS fade/slide, matching existing `fade-slide-in` animation)
- [ ] Update the progress indicator to show: `"Analyzed 3 of 18 clauses..."` with a determinate progress bar (since total is known from `clause_positions`)

#### 3.2 — Improve streaming UX

- [ ] The `StatusBar` should update more meaningfully now:
  - After `clause_positions`: `"Found 18 clauses. Analyzing..."`
  - During streaming: `"Analyzing clause 3 of 18..."` (update as each clause arrives)
  - Before summary: `"Generating summary..."`
- [ ] Consider adding a determinate progress bar below the status bar (thin colored bar that fills as clauses complete)
- [ ] The perceived speed improvement should be dramatic: instant skeleton cards, then results filling in within seconds
- [ ] Verify `prefers-reduced-motion` is respected for all animations

#### 3.3 — Remove old agent code

- [ ] Delete `packages/agents/src/parse.ts` (replaced by `heuristic-parse.ts`)
- [ ] Delete `packages/agents/src/prompts/parse.ts` (no longer used)
- [ ] Delete `packages/agents/src/risk.ts` (replaced by combined analysis)
- [ ] Delete `packages/agents/src/prompts/risk.ts` (replaced by combined analysis prompt)
- [ ] Delete `packages/agents/src/rewrite.ts` (replaced by combined analysis)
- [ ] Delete `packages/agents/src/prompts/rewrite.ts` (replaced by combined analysis prompt)
- [ ] Update `packages/agents/src/index.ts` to remove old exports, add new ones
- [ ] Delete or update old tests:
  - `packages/agents/src/__tests__/parse.test.ts` → delete (replaced by heuristic-parse tests)
  - `packages/agents/src/__tests__/risk.test.ts` → delete (replaced by combined-analysis tests)
  - `packages/agents/src/__tests__/rewrite.test.ts` → delete (replaced by combined-analysis tests)
  - `packages/agents/src/__tests__/orchestrator.test.ts` → already updated in Phase 2
  - Keep: `gate.test.ts`, `summary.test.ts`, `positions.test.ts`, `smoke.test.ts`
- [ ] Verify all imports across the codebase still resolve: `pnpm turbo type-check`
- [ ] Run `npx biome check --write` to fix any import ordering issues

#### 3.4 — Update shared types if needed

- [ ] Verify `ClauseAnalysis`, `Summary`, `SSEEvent` types are still correct
- [ ] If the `saferAlternative` field behavior changed (e.g., empty string instead of null for green clauses), update the Zod schema and any frontend checks
- [ ] Verify the frontend correctly handles both null and empty string for `saferAlternative`

#### 3.5 — Production deployment and validation

- [ ] Run full quality gate: `pnpm turbo lint type-check test build`
- [ ] Deploy to Vercel (or let auto-deploy on push)
- [ ] **Performance smoke test on production** — upload the Dutch test PDF and measure:
  - Time from upload to first clause result (target: <10 seconds)
  - Time from upload to all clauses complete (target: <30 seconds)
  - Time from upload to summary (target: <35 seconds)
  - Total Vercel function duration from logs
  - Number of SSE reconnections (target: 0 — should complete in one connection)
  - JSON parse errors (target: 0)
- [ ] **Quality smoke test on production:**
  - Upload a residential lease → verify clause count is reasonable, risk levels make sense
  - Upload a freelance contract → verify different patterns matched
  - Upload a non-contract → verify rejection still works
  - Upload a scanned PDF → verify rejection still works
  - Rate limit still works
  - Concurrent tabs still work (atomic claim)
  - Completed analysis loads from DB on refresh (no SSE needed)
- [ ] Check Vercel function logs for:
  - No Vercel Runtime Timeout errors
  - No JSON parse errors
  - Structured logs show pipeline timing
  - RAG patterns loaded correctly
- [ ] Compare before/after:
  | Metric | Before | After | Improvement |
  |--------|--------|-------|-------------|
  | Total time | 4-5 min | ? | ? |
  | First clause | 3+ min | ? | ? |
  | API calls | ~40 | 3 | ~13x fewer |
  | JSON errors | frequent | 0 | eliminated |
  | Vercel timeouts | frequent | 0 | eliminated |

#### 3.6 — Update documentation

- [ ] Update `packages/agents/CLAUDE.md`: remove references to deleted files, finalize new architecture docs
- [ ] Update root `CLAUDE.md`:
  - Update pipeline description
  - Remove "Parallel clause processing" note (replaced by single streaming call)
  - Remove "Pipeline resumability" notes about per-batch heartbeats (simplified)
  - Update "Clause position strategy" to note heuristic parse
  - Add note about `strict: true` structured outputs
  - Add performance characteristics
- [ ] Update `docs/BUILD_PLAN.md`: check off Phase 6 smoke tests if they now pass
- [ ] Update `README.md` architecture diagram if it references the old pipeline

### MCP Usage
- **Context7**: If clarification needed on Tailwind v4 animations, CSS transitions, or shadcn/ui components
- **Vercel MCP**: Check deployment logs, function duration, and verify no timeouts
- **Supabase MCP**: Verify production data looks correct after smoke tests
- **Playwright MCP**: Screenshot production pages for visual QA if desired

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Production smoke tests pass (all items in 3.5)
# Performance target met: <30 seconds total
```

### Exit Criteria
- [ ] Frontend renders skeleton cards immediately after heuristic parse
- [ ] Clause cards fill in progressively with smooth animation
- [ ] Progress indicator shows determinate progress (X of N)
- [ ] Old agent code (parse.ts, risk.ts, rewrite.ts) deleted
- [ ] All imports resolve, no dead code
- [ ] Production deployment works — no Vercel timeouts
- [ ] Performance validated: <30 seconds total, first clause in <10 seconds
- [ ] Zero JSON parse errors on production
- [ ] All smoke tests pass
- [ ] All documentation updated
- [ ] Quality gate passes
- [ ] Commit: `perf: frontend streaming UX, cleanup dead code, validate 15-20x speedup`

---

## Session Protocol

### Starting a phase
```
Read docs/PERF_BUILD_PLAN.md, begin Phase N
```

### During a phase
- Work through tasks in order
- Use specified MCPs when hitting unfamiliar APIs (especially Anthropic streaming/tool_use docs)
- Run quality gate commands frequently — don't accumulate debt
- If blocked, note the blocker and move to the next task if independent
- If the Anthropic streaming/tool_use API behaves differently than documented here, adapt — the research was thorough but APIs evolve

### Before finishing a phase
Verify all of these before committing:
- [ ] All completed tasks checked off in this file
- [ ] CLAUDE.md updated in every package you modified
- [ ] Root CLAUDE.md updated if architecture changed
- [ ] `pnpm turbo lint type-check test build` passes
- [ ] Commit with conventional commit message

### Between phases
- `/clear` before starting the next phase
- Start fresh — the build plan and code are the source of truth
- Re-read this plan at the start of each session

---

## Rollback Plan

If the new pipeline produces worse analysis quality:
1. The old agents (`risk.ts`, `rewrite.ts`, `parse.ts`) are retained through Phase 2
2. The orchestrator can be reverted to import the old per-clause agents
3. The heuristic parser can be swapped back for the LLM parse
4. RAG can revert to per-clause embedding + vector search

The DB schema is unchanged. The SSE event types are backwards-compatible (new `clause_positions` event is additive). The frontend gracefully handles missing events.
